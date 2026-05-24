#include <node_api.h>

#import <AppKit/AppKit.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <OpenDirectory/OpenDirectory.h>
#import <Security/Security.h>
#import <SystemConfiguration/SystemConfiguration.h>

#if __has_include(<LocalAuthenticationEmbeddedUI/LAAuthenticationView.h>)
#import <LocalAuthenticationEmbeddedUI/LAAuthenticationView.h>
#define RECALL_HAS_EMBEDDED_AUTH_UI 1
#else
#define RECALL_HAS_EMBEDDED_AUTH_UI 0
#endif

#include <dispatch/dispatch.h>
#include <pwd.h>
#include <cstring>
#include <string>
#include <vector>

namespace {

constexpr CGFloat kEmbeddedAuthSymbolScale = 0.92;
constexpr CGFloat kPasswordFallbackGap = 14.0;
constexpr CGFloat kPasswordFallbackWidth = 184.0;
constexpr CGFloat kPasswordFallbackHeight = 25.0;
constexpr CGFloat kPasswordFallbackMargin = 12.0;
constexpr NSTimeInterval kPasswordFailureBaseDelay = 1.0;
constexpr NSTimeInterval kPasswordFailureMaxDelay = 8.0;
NSString *const kCustomPasswordService = @"com.recall.locked-notes.custom-password";

struct AuthRect {
  double x = 0;
  double y = 0;
  double width = 0;
  double height = 0;
  double scaleFactor = 1;
};

struct AuthInput {
  uintptr_t nativeWindowHandle = 0;
  std::string authMethod = "login";
  std::string noteId;
  std::string passwordPlaceholder = "Password";
  std::string reason = "View this locked note in Recall";
  AuthRect rect;
  AuthRect passwordRect;
  bool hasPasswordRect = false;
  bool debug = false;
  bool useTouchId = true;
};

struct NativePasswordResult {
  bool ok = false;
  const char *code = "verification_error";
};

enum class AuthMode {
  Embedded,
  Modal,
  CustomPasswordChange,
};

struct AuthBaton {
  napi_env env = nullptr;
  napi_deferred deferred = nullptr;
  napi_async_work work = nullptr;
  AuthMode mode = AuthMode::Embedded;
  AuthInput input;
  dispatch_semaphore_t semaphore = nullptr;
  bool resolved = false;
  bool ok = false;
  std::string code = "authentication_failed";
};

void DebugLog(const AuthInput &input, const char *message) {
  if (input.debug) {
    fprintf(stderr, "%s\n", message);
  }
}

void RunOnMainSync(dispatch_block_t block) {
  if ([NSThread isMainThread]) {
    block();
    return;
  }

  dispatch_sync(dispatch_get_main_queue(), block);
}

napi_value MakeResult(napi_env env, bool ok, const char *code) {
  napi_value result;
  napi_create_object(env, &result);

  napi_value okValue;
  napi_get_boolean(env, ok, &okValue);
  napi_set_named_property(env, result, "ok", okValue);

  napi_value codeValue;
  napi_create_string_utf8(env, code, NAPI_AUTO_LENGTH, &codeValue);
  napi_set_named_property(env, result, "code", codeValue);

  if (!ok) {
    napi_set_named_property(env, result, "error", codeValue);
  }

  return result;
}

void ResolveBaton(AuthBaton *baton, bool ok, const char *code) {
  if (!baton || baton->resolved) {
    return;
  }

  baton->resolved = true;
  baton->ok = ok;
  baton->code = code ? code : (ok ? "success" : "authentication_failed");
  dispatch_semaphore_signal(baton->semaphore);
}

bool GetProperty(napi_env env, napi_value object, const char *name, napi_value *out) {
  bool hasProperty = false;
  if (napi_has_named_property(env, object, name, &hasProperty) != napi_ok ||
      !hasProperty) {
    return false;
  }

  return napi_get_named_property(env, object, name, out) == napi_ok;
}

bool ReadString(napi_env env, napi_value object, const char *name, std::string *out) {
  napi_value value;
  if (!GetProperty(env, object, name, &value)) {
    return false;
  }

  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) {
    return false;
  }

  std::vector<char> buffer(length + 1);
  if (napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(), &length) !=
      napi_ok) {
    return false;
  }

  *out = std::string(buffer.data(), length);
  return true;
}

bool ReadOptionalString(
    napi_env env,
    napi_value object,
    const char *name,
    std::string *out) {
  napi_value value;
  if (!GetProperty(env, object, name, &value)) {
    return true;
  }

  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) {
    return false;
  }

  std::vector<char> buffer(length + 1);
  if (napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(), &length) !=
      napi_ok) {
    return false;
  }

  *out = std::string(buffer.data(), length);
  return true;
}

bool ReadOptionalBool(napi_env env, napi_value object, const char *name, bool *out) {
  napi_value value;
  if (!GetProperty(env, object, name, &value)) {
    return true;
  }

  return napi_get_value_bool(env, value, out) == napi_ok;
}

bool ReadNumber(napi_env env, napi_value object, const char *name, double *out) {
  napi_value value;
  if (!GetProperty(env, object, name, &value)) {
    return false;
  }

  return napi_get_value_double(env, value, out) == napi_ok;
}

bool ReadNativeWindowHandle(napi_env env, napi_value object, uintptr_t *out) {
  napi_value value;
  if (!GetProperty(env, object, "nativeWindowHandle", &value)) {
    return false;
  }

  bool isBuffer = false;
  if (napi_is_buffer(env, value, &isBuffer) != napi_ok || !isBuffer) {
    return false;
  }

  void *data = nullptr;
  size_t length = 0;
  if (napi_get_buffer_info(env, value, &data, &length) != napi_ok ||
      length < sizeof(uintptr_t)) {
    return false;
  }

  uintptr_t pointer = 0;
  memcpy(&pointer, data, sizeof(uintptr_t));
  *out = pointer;
  return pointer != 0;
}

bool ReadRect(napi_env env, napi_value object, AuthRect *rect) {
  napi_value rectValue;
  if (!GetProperty(env, object, "rect", &rectValue)) {
    return false;
  }

  if (!ReadNumber(env, rectValue, "x", &rect->x) ||
      !ReadNumber(env, rectValue, "y", &rect->y) ||
      !ReadNumber(env, rectValue, "width", &rect->width) ||
      !ReadNumber(env, rectValue, "height", &rect->height)) {
    return false;
  }

  double scaleFactor = 1;
  if (ReadNumber(env, rectValue, "scaleFactor", &scaleFactor) && scaleFactor > 0) {
    rect->scaleFactor = scaleFactor;
  }

  return rect->width > 0 && rect->height > 0;
}

bool ReadNamedRect(napi_env env, napi_value object, const char *name, AuthRect *rect) {
  napi_value rectValue;
  if (!GetProperty(env, object, name, &rectValue)) {
    return false;
  }

  if (!ReadNumber(env, rectValue, "x", &rect->x) ||
      !ReadNumber(env, rectValue, "y", &rect->y) ||
      !ReadNumber(env, rectValue, "width", &rect->width) ||
      !ReadNumber(env, rectValue, "height", &rect->height)) {
    return false;
  }

  double scaleFactor = 1;
  if (ReadNumber(env, rectValue, "scaleFactor", &scaleFactor) && scaleFactor > 0) {
    rect->scaleFactor = scaleFactor;
  }

  return rect->width > 0 && rect->height > 0;
}

bool ReadInput(napi_env env, napi_callback_info info, AuthInput *input, bool needsRect) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok ||
      argc < 1) {
    return false;
  }

  if (!ReadString(env, args[0], "noteId", &input->noteId)) {
    return false;
  }

  if (!ReadOptionalString(env, args[0], "reason", &input->reason) ||
      !ReadOptionalBool(env, args[0], "debug", &input->debug)) {
    return false;
  }

  std::string authMethod = input->authMethod;
  if (!ReadOptionalString(env, args[0], "authMethod", &authMethod)) {
    return false;
  }
  if (authMethod == "login" || authMethod == "custom") {
    input->authMethod = authMethod;
  } else {
    return false;
  }

  if (!ReadOptionalString(
          env, args[0], "passwordPlaceholder", &input->passwordPlaceholder) ||
      !ReadOptionalBool(env, args[0], "useTouchId", &input->useTouchId)) {
    return false;
  }
  if (input->passwordPlaceholder.empty() ||
      input->passwordPlaceholder.size() > 80) {
    input->passwordPlaceholder = "Password";
  }

  if (needsRect &&
      (!ReadNativeWindowHandle(env, args[0], &input->nativeWindowHandle) ||
       !ReadRect(env, args[0], &input->rect))) {
    return false;
  }

  napi_value passwordRectValue;
  if (needsRect && GetProperty(env, args[0], "passwordRect", &passwordRectValue)) {
    if (!ReadNamedRect(env, args[0], "passwordRect", &input->passwordRect)) {
      return false;
    }
    input->hasPasswordRect = true;
  }

  if (!needsRect) {
    ReadNativeWindowHandle(env, args[0], &input->nativeWindowHandle);
  }

  return !input->noteId.empty();
}

NSString *SessionKey(uintptr_t nativeWindowHandle, const std::string &noteId) {
  return [NSString stringWithFormat:@"%llx:%s",
                                    static_cast<unsigned long long>(nativeWindowHandle),
                                    noteId.c_str()];
}

NSMutableDictionary<NSString *, id> *Sessions() {
  static NSMutableDictionary<NSString *, id> *sessions = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    sessions = [NSMutableDictionary dictionary];
  });
  return sessions;
}

NSString *MapLAErrorCode(NSError *error) {
  if (!error) {
    return @"authentication_failed";
  }

  if ([error.domain isEqualToString:LAErrorDomain]) {
    switch (error.code) {
      case LAErrorUserCancel:
      case LAErrorUserFallback:
      case LAErrorSystemCancel:
      case LAErrorAppCancel:
        return @"cancelled";
      case LAErrorPasscodeNotSet:
      case LAErrorBiometryNotAvailable:
      case LAErrorBiometryNotEnrolled:
      case LAErrorBiometryLockout:
      case LAErrorBiometryNotPaired:
      case LAErrorBiometryDisconnected:
      case LAErrorInvalidDimensions:
        return @"unavailable";
      case LAErrorAuthenticationFailed:
        return @"authentication_failed";
      default:
        return @"authentication_failed";
    }
  }

  return @"authentication_failed";
}

NSView *ViewFromNativeHandle(uintptr_t nativeWindowHandle) {
  if (!nativeWindowHandle) {
    return nil;
  }

  id nativeObject = (__bridge id)(reinterpret_cast<void *>(nativeWindowHandle));
  if ([nativeObject isKindOfClass:[NSWindow class]]) {
    return [(NSWindow *)nativeObject contentView];
  }
  if ([nativeObject isKindOfClass:[NSView class]]) {
    return (NSView *)nativeObject;
  }

  return nil;
}

NSRect RectInAppKitPoints(const AuthRect &rect, NSWindow *window) {
  CGFloat scaleFactor = rect.scaleFactor > 0 ? rect.scaleFactor : 1;
  if (window && window.backingScaleFactor > 0) {
    scaleFactor = rect.scaleFactor > 0 ? rect.scaleFactor : window.backingScaleFactor;
  }

  return NSMakeRect(
      rect.x / scaleFactor,
      rect.y / scaleFactor,
      rect.width / scaleFactor,
      rect.height / scaleFactor);
}

NSString *NormalizedConsoleUsername(NSString *username) {
  if (![username isKindOfClass:[NSString class]]) {
    return nil;
  }

  NSString *trimmed = [username stringByTrimmingCharactersInSet:
                                    [NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (trimmed.length == 0 || [trimmed isEqualToString:@"loginwindow"]) {
    return nil;
  }

  return trimmed;
}

NSString *CurrentConsoleUsername(uid_t *uidOut) {
  uid_t uid = 0;
  gid_t gid = 0;
  CFStringRef consoleUserRef = SCDynamicStoreCopyConsoleUser(nullptr, &uid, &gid);
  NSString *consoleUser = CFBridgingRelease(consoleUserRef);
  NSString *username = NormalizedConsoleUsername(consoleUser);
  if (username) {
    if (uidOut) {
      *uidOut = uid;
    }
    return username;
  }

  NSString *fallback = NormalizedConsoleUsername(NSUserName());
  if (fallback && uidOut) {
    struct passwd *passwd = getpwnam(fallback.UTF8String);
    *uidOut = passwd ? passwd->pw_uid : getuid();
  }

  return fallback;
}

ODRecord *CopyUserRecord(NSString *username, ODNodeType nodeType, NSError **outError) {
  NSError *nodeError = nil;
  ODNode *node = [ODNode nodeWithSession:[ODSession defaultSession]
                                    type:nodeType
                                   error:&nodeError];
  if (!node) {
    if (outError) {
      *outError = nodeError;
    }
    return nil;
  }

  NSError *recordError = nil;
  ODRecord *record = [node recordWithRecordType:kODRecordTypeUsers
                                           name:username
                                     attributes:nil
                                          error:&recordError];
  if (!record && outError) {
    *outError = recordError;
  }

  return record;
}

bool IsInvalidPasswordError(NSError *error) {
  return error &&
      [error.domain isEqualToString:ODFrameworkErrorDomain] &&
      error.code == kODErrorCredentialsInvalid;
}

NativePasswordResult VerifyRecordPassword(ODRecord *record, NSString *password) {
  NSError *verifyError = nil;
  if ([record verifyPassword:password error:&verifyError]) {
    return {true, "success"};
  }

  return {
      false,
      IsInvalidPasswordError(verifyError) ? "invalid_password" : "verification_error"};
}

NativePasswordResult VerifyCurrentConsoleUserPassword(NSString *password) {
  if (!password) {
    return {false, "invalid_password"};
  }

  uid_t uid = 0;
  NSString *username = CurrentConsoleUsername(&uid);
  if (!username) {
    return {false, "user_not_found"};
  }

  ODRecord *authRecord =
      CopyUserRecord(username, kODNodeTypeAuthentication, nil);
  if (authRecord) {
    return VerifyRecordPassword(authRecord, password);
  }

  ODRecord *localRecord =
      CopyUserRecord(username, kODNodeTypeLocalNodes, nil);
  if (localRecord) {
    return VerifyRecordPassword(localRecord, password);
  }

  return {false, "user_not_found"};
}

NSString *CustomPasswordAccount(NativePasswordResult *outError) {
  uid_t uid = 0;
  NSString *username = CurrentConsoleUsername(&uid);
  if (!username) {
    if (outError) {
      *outError = {false, "user_not_found"};
    }
    return nil;
  }

  return [NSString stringWithFormat:@"%@:%u", username, uid];
}

NSMutableDictionary *CustomPasswordQuery(NSString *account) {
  return [@{
    (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService : kCustomPasswordService,
    (__bridge id)kSecAttrAccount : account,
  } mutableCopy];
}

NativePasswordResult CopyCustomPasswordData(NSData **outData) {
  NativePasswordResult accountError;
  NSString *account = CustomPasswordAccount(&accountError);
  if (!account) {
    return accountError;
  }

  NSMutableDictionary *query = CustomPasswordQuery(account);
  query[(__bridge id)kSecReturnData] = @YES;
  query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;

  CFTypeRef result = nullptr;
  OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
  if (status == errSecItemNotFound) {
    return {false, "invalid_password"};
  }
  if (status != errSecSuccess) {
    return {false, "verification_error"};
  }

  NSData *data = CFBridgingRelease(result);
  if (![data isKindOfClass:[NSData class]]) {
    return {false, "verification_error"};
  }

  if (outData) {
    *outData = data;
  }
  return {true, "success"};
}

bool ConstantTimeEqual(NSData *left, NSData *right) {
  const NSUInteger leftLength = left.length;
  const NSUInteger rightLength = right.length;
  const NSUInteger maxLength = MAX(leftLength, rightLength);
  const unsigned char *leftBytes =
      static_cast<const unsigned char *>(left.bytes);
  const unsigned char *rightBytes =
      static_cast<const unsigned char *>(right.bytes);
  unsigned char diff =
      static_cast<unsigned char>((leftLength ^ rightLength) & 0xff);

  for (NSUInteger index = 0; index < maxLength; index += 1) {
    const unsigned char leftByte = index < leftLength ? leftBytes[index] : 0;
    const unsigned char rightByte = index < rightLength ? rightBytes[index] : 0;
    diff |= leftByte ^ rightByte;
  }

  return diff == 0;
}

NativePasswordResult StoreCustomPassword(NSString *password) {
  if (!password || password.length == 0) {
    return {false, "invalid_password"};
  }

  NativePasswordResult accountError;
  NSString *account = CustomPasswordAccount(&accountError);
  if (!account) {
    return accountError;
  }

  NSData *passwordData = [password dataUsingEncoding:NSUTF8StringEncoding];
  if (passwordData.length == 0) {
    return {false, "invalid_password"};
  }

  NSMutableDictionary *query = CustomPasswordQuery(account);
  OSStatus existsStatus =
      SecItemCopyMatching((__bridge CFDictionaryRef)query, nullptr);
  if (existsStatus == errSecSuccess) {
    NSDictionary *attributes = @{(__bridge id)kSecValueData : passwordData};
    OSStatus updateStatus =
        SecItemUpdate((__bridge CFDictionaryRef)query,
                      (__bridge CFDictionaryRef)attributes);
    return updateStatus == errSecSuccess
        ? NativePasswordResult{true, "success"}
        : NativePasswordResult{false, "verification_error"};
  }

  if (existsStatus != errSecItemNotFound) {
    return {false, "verification_error"};
  }

  NSMutableDictionary *addQuery = CustomPasswordQuery(account);
  addQuery[(__bridge id)kSecValueData] = passwordData;
  addQuery[(__bridge id)kSecAttrAccessible] =
      (__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly;

  OSStatus addStatus = SecItemAdd((__bridge CFDictionaryRef)addQuery, nullptr);
  return addStatus == errSecSuccess
      ? NativePasswordResult{true, "success"}
      : NativePasswordResult{false, "verification_error"};
}

NativePasswordResult VerifyCustomPassword(NSString *password) {
  if (!password || password.length == 0) {
    return {false, "invalid_password"};
  }

  NSData *storedPassword = nil;
  NativePasswordResult copyResult = CopyCustomPasswordData(&storedPassword);
  if (!copyResult.ok) {
    return copyResult;
  }

  NSData *candidate = [password dataUsingEncoding:NSUTF8StringEncoding];
  if (candidate.length == 0 || !ConstantTimeEqual(storedPassword, candidate)) {
    return {false, "invalid_password"};
  }

  return {true, "success"};
}

bool HasCustomPassword() {
  NSData *storedPassword = nil;
  NativePasswordResult result = CopyCustomPasswordData(&storedPassword);
  return result.ok && storedPassword.length > 0;
}

NSAttributedString *PasswordPlaceholderString(NSString *message, NSFont *font) {
  NSMutableParagraphStyle *paragraphStyle =
      [[NSMutableParagraphStyle alloc] init];
  paragraphStyle.alignment = NSTextAlignmentCenter;

  return [[NSAttributedString alloc]
      initWithString:message ?: @"Password"
          attributes:@{
            NSForegroundColorAttributeName : [NSColor placeholderTextColor],
            NSFontAttributeName : font ?: [NSFont systemFontOfSize:13],
            NSParagraphStyleAttributeName : paragraphStyle,
          }];
}

NSRect PasswordPanelFrameForAuthRect(NSRect authRect, NSView *hostView) {
  NSRect hostBounds = hostView ? hostView.bounds : NSZeroRect;
  CGFloat width = MIN(kPasswordFallbackWidth,
                      MAX(160.0, hostBounds.size.width - (kPasswordFallbackMargin * 2.0)));
  CGFloat height = kPasswordFallbackHeight;
  CGFloat x = NSMidX(authRect) - (width / 2.0);
  CGFloat y = NSMinY(authRect) - kPasswordFallbackGap - height;

  if (hostBounds.size.height > 0 && y < kPasswordFallbackMargin) {
    y = NSMaxY(authRect) + kPasswordFallbackGap;
  }

  if (hostBounds.size.width > 0) {
    x = MAX(kPasswordFallbackMargin,
            MIN(x, hostBounds.size.width - width - kPasswordFallbackMargin));
  }
  if (hostBounds.size.height > 0) {
    y = MAX(kPasswordFallbackMargin,
            MIN(y, hostBounds.size.height - height - kPasswordFallbackMargin));
  }

  return NSMakeRect(x, y, width, height);
}

}  // namespace

@interface RecallTouchIdBadgeView : NSView
@end

@implementation RecallTouchIdBadgeView

- (NSView *)hitTest:(NSPoint)point {
  return nil;
}

- (BOOL)isFlipped {
  return YES;
}

- (BOOL)isOpaque {
  return NO;
}

- (void)drawRect:(NSRect)dirtyRect {
  [super drawRect:dirtyRect];

  NSRect bounds = self.bounds;
  [[NSColor colorWithCalibratedWhite:0.12 alpha:1.0] setFill];
  [[NSBezierPath bezierPathWithOvalInRect:bounds] fill];

  if (@available(macOS 11.0, *)) {
    NSImage *symbol =
        [NSImage imageWithSystemSymbolName:@"touchid" accessibilityDescription:nil];
    if (!symbol) {
      return;
    }

    CGFloat symbolSize = floor(MIN(bounds.size.width, bounds.size.height) *
                               kEmbeddedAuthSymbolScale);
    NSImageSymbolConfiguration *configuration =
        [NSImageSymbolConfiguration configurationWithPointSize:symbolSize
                                                       weight:NSFontWeightRegular
                                                        scale:NSImageSymbolScaleMedium];
    NSImage *configuredSymbol = [symbol imageWithSymbolConfiguration:configuration] ?: symbol;
    NSImage *tintedSymbol =
        [[NSImage alloc] initWithSize:NSMakeSize(symbolSize, symbolSize)];
    NSRect imageRect = NSMakeRect(0, 0, symbolSize, symbolSize);
    [tintedSymbol lockFocus];
    [configuredSymbol drawInRect:imageRect
                         fromRect:NSZeroRect
                        operation:NSCompositingOperationSourceOver
                         fraction:1.0
                   respectFlipped:NO
                            hints:nil];
    [[NSColor colorWithCalibratedRed:1.0 green:0.29 blue:0.39 alpha:1.0] setFill];
    NSRectFillUsingOperation(imageRect, NSCompositingOperationSourceIn);
    [tintedSymbol unlockFocus];

    NSRect symbolRect = NSMakeRect(
        NSMidX(bounds) - (symbolSize / 2.0),
        NSMidY(bounds) - (symbolSize / 2.0),
        symbolSize,
        symbolSize);
    [tintedSymbol drawInRect:symbolRect
                    fromRect:NSZeroRect
                   operation:NSCompositingOperationSourceOver
                    fraction:1.0
              respectFlipped:YES
                       hints:nil];
  }
}

@end

@interface RecallNativeAuthSession : NSObject
@property(nonatomic) uintptr_t nativeWindowHandle;
@property(nonatomic, copy) NSString *noteId;
@property(nonatomic, copy) NSString *key;
@property(nonatomic, strong) LAContext *context;
#if RECALL_HAS_EMBEDDED_AUTH_UI
@property(nonatomic, strong) NSView *container;
@property(nonatomic, strong) NSView *clipView;
@property(nonatomic, strong) RecallTouchIdBadgeView *badgeView;
@property(nonatomic, strong) LAAuthenticationView *view;
#endif
@property(nonatomic, copy) NSString *authMethod;
@property(nonatomic, strong) NSSecureTextField *passwordField;
@property(nonatomic, copy) NSString *passwordPlaceholder;
@property(nonatomic) void *baton;
@property(nonatomic) BOOL completed;
@property(nonatomic) BOOL debug;
@property(nonatomic) NSInteger passwordFailureCount;
@property(nonatomic) NSTimeInterval nextPasswordAttemptTime;
@property(nonatomic) BOOL verifyingPassword;
- (void)submitPassword:(id)sender;
@end

namespace {

void FinishSession(RecallNativeAuthSession *session, bool ok, NSString *code) {
  if (!session || session.completed) {
    return;
  }

  session.completed = YES;
#if RECALL_HAS_EMBEDDED_AUTH_UI
  if (session.container) {
    [session.container removeFromSuperview];
    session.container = nil;
    session.clipView = nil;
    session.badgeView = nil;
    session.view = nil;
  }
#endif
  if (session.passwordField) {
    session.passwordField.stringValue = @"";
    [session.passwordField removeFromSuperview];
    session.passwordField = nil;
  }
  [session.context invalidate];

  if (session.key) {
    id current = Sessions()[session.key];
    if (current == session) {
      [Sessions() removeObjectForKey:session.key];
    }
  }

  if (session.debug) {
    fprintf(stderr, "native-auth: overlay removed\n");
  }

  AuthBaton *baton = reinterpret_cast<AuthBaton *>(session.baton);
  if (baton) {
    ResolveBaton(baton, ok, code.UTF8String);
  }
}

void FinishExistingSession(uintptr_t nativeWindowHandle, const std::string &noteId) {
  NSString *key = SessionKey(nativeWindowHandle, noteId);
  RecallNativeAuthSession *existing = Sessions()[key];
  if (existing) {
    FinishSession(existing, false, @"cancelled");
  }
}

void HideSessions(uintptr_t nativeWindowHandle, const std::string &noteId) {
  NSArray<NSString *> *keys = [Sessions().allKeys copy];
  NSString *targetNoteId = noteId.empty()
      ? nil
      : [NSString stringWithUTF8String:noteId.c_str()];

  for (NSString *key in keys) {
    RecallNativeAuthSession *session = Sessions()[key];
    if (nativeWindowHandle != 0 && session.nativeWindowHandle != nativeWindowHandle) {
      continue;
    }
    if (targetNoteId && ![session.noteId isEqualToString:targetNoteId]) {
      continue;
    }

    FinishSession(session, false, @"cancelled");
  }
}

void SetPasswordPlaceholder(RecallNativeAuthSession *session, NSString *message) {
  if (!session.passwordField) {
    return;
  }

  session.passwordField.placeholderAttributedString =
      PasswordPlaceholderString(
          message ?: session.passwordPlaceholder ?: @"Password",
          session.passwordField.font);
}

void SetPasswordControlsEnabled(RecallNativeAuthSession *session, BOOL enabled) {
  session.passwordField.enabled = enabled;
}

void ApplyPasswordVerificationResult(
    RecallNativeAuthSession *session,
    NativePasswordResult result) {
  if (!session || session.completed) {
    return;
  }

  session.verifyingPassword = NO;
  SetPasswordControlsEnabled(session, YES);

  if (result.ok) {
    FinishSession(session, true, @"success");
    return;
  }

  NSString *code = [NSString stringWithUTF8String:result.code ?: "verification_error"];
  if ([code isEqualToString:@"invalid_password"]) {
    session.passwordFailureCount += 1;
    NSInteger exponent = MIN(session.passwordFailureCount - 1, 3);
    NSTimeInterval delay = MIN(
        kPasswordFailureMaxDelay,
        kPasswordFailureBaseDelay * static_cast<NSTimeInterval>(1 << exponent));
    session.nextPasswordAttemptTime =
        [NSDate timeIntervalSinceReferenceDate] + delay;
    SetPasswordPlaceholder(session, @"Invalid password");
    return;
  }

  if ([code isEqualToString:@"user_not_found"]) {
    SetPasswordPlaceholder(session, @"User not found");
    return;
  }

  if ([code isEqualToString:@"unsupported_platform"]) {
    SetPasswordPlaceholder(session, @"Password unavailable");
    return;
  }

  SetPasswordPlaceholder(session, @"Verification failed");
}

}  // namespace

@implementation RecallNativeAuthSession

- (void)submitPassword:(id)sender {
  if (self.completed || self.verifyingPassword) {
    return;
  }

  NSTimeInterval now = [NSDate timeIntervalSinceReferenceDate];
  if (self.nextPasswordAttemptTime > now) {
    SetPasswordPlaceholder(self, @"Wait before trying again");
    return;
  }

  __block NSString *password = [self.passwordField.stringValue copy] ?: @"";
  self.passwordField.stringValue = @"";
  if (password.length == 0) {
    SetPasswordPlaceholder(self, self.passwordPlaceholder);
    return;
  }

  self.verifyingPassword = YES;
  SetPasswordControlsEnabled(self, NO);
  SetPasswordPlaceholder(self, @"Verifying...");

  __weak RecallNativeAuthSession *weakSelf = self;
  NSString *authMethod = [self.authMethod copy] ?: @"login";
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    @autoreleasepool {
      NativePasswordResult result =
          [authMethod isEqualToString:@"custom"]
              ? VerifyCustomPassword(password)
              : VerifyCurrentConsoleUserPassword(password);
      password = nil;
      dispatch_async(dispatch_get_main_queue(), ^{
        RecallNativeAuthSession *strongSelf = weakSelf;
        if (!strongSelf) {
          return;
        }
        ApplyPasswordVerificationResult(strongSelf, result);
      });
    }
  });
}

@end

namespace {

NSRect PasswordFrameForInput(const AuthInput &input, NSWindow *window, NSView *hostView) {
  if (input.hasPasswordRect) {
    return RectInAppKitPoints(input.passwordRect, window);
  }

  return PasswordPanelFrameForAuthRect(RectInAppKitPoints(input.rect, window), hostView);
}

void CreatePasswordOverlay(RecallNativeAuthSession *session, NSView *hostView, NSRect frame) {
  NSSecureTextField *passwordField =
      [[NSSecureTextField alloc] initWithFrame:frame];
  passwordField.placeholderString = session.passwordPlaceholder ?: @"Password";
  passwordField.target = session;
  passwordField.action = @selector(submitPassword:);
  passwordField.alignment = NSTextAlignmentLeft;
  passwordField.bezelStyle = NSTextFieldRoundedBezel;
  passwordField.focusRingType = NSFocusRingTypeDefault;
  passwordField.font = [NSFont systemFontOfSize:13];
  passwordField.controlSize = NSControlSizeRegular;
  passwordField.placeholderAttributedString =
      PasswordPlaceholderString(session.passwordPlaceholder ?: @"Password",
                                passwordField.font);
  passwordField.autoresizingMask = NSViewNotSizable;

  [hostView addSubview:passwordField positioned:NSWindowAbove relativeTo:nil];

  session.passwordField = passwordField;

  [hostView.window makeFirstResponder:passwordField];
}

void UpdatePasswordOverlay(RecallNativeAuthSession *session, NSRect frame) {
  if (!session.passwordField) {
    return;
  }

  session.passwordField.frame = frame;
}

void StartEmbeddedAuth(AuthBaton *baton) {
  NSView *electronView = ViewFromNativeHandle(baton->input.nativeWindowHandle);
  NSWindow *window = electronView.window;
  NSView *hostView = window.contentView ?: electronView;
  if (!hostView || !window) {
    DebugLog(baton->input, "native-auth: embedded view unavailable");
    ResolveBaton(baton, false, "embedded_ui_unavailable");
    return;
  }

  FinishExistingSession(baton->input.nativeWindowHandle, baton->input.noteId);

  RecallNativeAuthSession *session = [[RecallNativeAuthSession alloc] init];
  session.nativeWindowHandle = baton->input.nativeWindowHandle;
  session.noteId = [NSString stringWithUTF8String:baton->input.noteId.c_str()];
  session.key = SessionKey(baton->input.nativeWindowHandle, baton->input.noteId);
  session.authMethod =
      [NSString stringWithUTF8String:baton->input.authMethod.c_str()];
  session.passwordPlaceholder =
      [NSString stringWithUTF8String:baton->input.passwordPlaceholder.c_str()];
  session.baton = baton;
  session.debug = baton->input.debug;

  BOOL didAttachTouchId = NO;

#if RECALL_HAS_EMBEDDED_AUTH_UI
  if (baton->input.useTouchId) {
    if (@available(macOS 12.0, *)) {
      Class authViewClass = NSClassFromString(@"LAAuthenticationView");
      if (authViewClass) {
        LAContext *context = [[LAContext alloc] init];
        context.localizedFallbackTitle = @"Enter Password";

        NSError *canEvaluateError = nil;
        if ([context canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
                                 error:&canEvaluateError]) {
          session.context = context;

          NSView *container =
              [[NSView alloc] initWithFrame:RectInAppKitPoints(baton->input.rect, window)];
          container.wantsLayer = YES;
          container.layer.masksToBounds = NO;
          container.layer.shadowColor = [NSColor blackColor].CGColor;
          container.layer.shadowOffset = CGSizeMake(0, -8);
          container.layer.shadowOpacity = 0.28;
          container.layer.shadowRadius = 18;
          container.autoresizingMask = NSViewNotSizable;

          NSView *clipView = [[NSView alloc] initWithFrame:container.bounds];
          clipView.wantsLayer = YES;
          clipView.layer.backgroundColor =
              [NSColor colorWithCalibratedWhite:0.12 alpha:1.0].CGColor;
          clipView.layer.cornerRadius =
              MIN(clipView.bounds.size.width, clipView.bounds.size.height) / 2.0;
          clipView.layer.masksToBounds = YES;
          clipView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;

          LAAuthenticationView *view =
              [[LAAuthenticationView alloc] initWithContext:context
                                                controlSize:NSControlSizeRegular];
          view.frame = clipView.bounds;
          view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;

          RecallTouchIdBadgeView *badgeView =
              [[RecallTouchIdBadgeView alloc] initWithFrame:clipView.bounds];
          badgeView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;

          [clipView addSubview:view];
          [clipView addSubview:badgeView];
          [container addSubview:clipView];
          [hostView addSubview:container positioned:NSWindowAbove relativeTo:nil];
          session.container = container;
          session.clipView = clipView;
          session.badgeView = badgeView;
          session.view = view;
          didAttachTouchId = YES;
        } else {
          DebugLog(baton->input, "native-auth: Touch ID unavailable; password only");
        }
      } else {
        DebugLog(baton->input, "native-auth: embedded view unavailable; password only");
      }
    }
  }
#endif

  CreatePasswordOverlay(
      session,
      hostView,
      PasswordFrameForInput(baton->input, window, hostView));
  Sessions()[session.key] = session;

  if (!didAttachTouchId) {
    DebugLog(baton->input, "native-auth: password overlay attached");
    return;
  }

  DebugLog(baton->input, "native-auth: embedded view attached");

  NSString *reason = [NSString stringWithUTF8String:baton->input.reason.c_str()];
  LAContext *context = session.context;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (session.completed) {
      return;
    }

    [context evaluatePolicy:LAPolicyDeviceOwnerAuthentication
            localizedReason:reason
                      reply:^(BOOL success, NSError *error) {
                        dispatch_async(dispatch_get_main_queue(), ^{
                          FinishSession(
                              session,
                              success,
                              success ? @"success" : MapLAErrorCode(error));
                        });
                      }];
  });
}

void StartModalAuth(AuthBaton *baton) {
  LAContext *context = [[LAContext alloc] init];
  NSError *canEvaluateError = nil;
  if (![context canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication
                             error:&canEvaluateError]) {
    ResolveBaton(baton, false, MapLAErrorCode(canEvaluateError).UTF8String);
    return;
  }

  NSString *reason = [NSString stringWithUTF8String:baton->input.reason.c_str()];
  [context evaluatePolicy:LAPolicyDeviceOwnerAuthentication
          localizedReason:reason
                    reply:^(BOOL success, NSError *error) {
                      dispatch_async(dispatch_get_main_queue(), ^{
                        ResolveBaton(
                            baton,
                            success,
                            success ? "success" : MapLAErrorCode(error).UTF8String);
                      });
                    }];
}

NativePasswordResult PromptForNewCustomPassword(NSWindow *window) {
  NSAlert *alert = [[NSAlert alloc] init];
  alert.messageText = @"Change Locked Notes Password";
  alert.informativeText = @"Enter a new note password.";
  [alert addButtonWithTitle:@"Save"];
  [alert addButtonWithTitle:@"Cancel"];

  NSStackView *stackView = [[NSStackView alloc] initWithFrame:NSMakeRect(0, 0, 320, 64)];
  stackView.orientation = NSUserInterfaceLayoutOrientationVertical;
  stackView.spacing = 8;
  stackView.translatesAutoresizingMaskIntoConstraints = NO;

  NSSecureTextField *passwordField =
      [[NSSecureTextField alloc] initWithFrame:NSMakeRect(0, 36, 320, 28)];
  passwordField.placeholderString = @"New note password";
  NSSecureTextField *confirmField =
      [[NSSecureTextField alloc] initWithFrame:NSMakeRect(0, 0, 320, 28)];
  confirmField.placeholderString = @"Verify note password";

  [stackView addArrangedSubview:passwordField];
  [stackView addArrangedSubview:confirmField];
  [stackView.widthAnchor constraintEqualToConstant:320].active = YES;
  alert.accessoryView = stackView;

  NSModalResponse response = window
      ? [alert runModal]
      : [alert runModal];
  if (response != NSAlertFirstButtonReturn) {
    passwordField.stringValue = @"";
    confirmField.stringValue = @"";
    return {false, "cancelled"};
  }

  NSString *password = [passwordField.stringValue copy] ?: @"";
  NSString *confirmation = [confirmField.stringValue copy] ?: @"";
  passwordField.stringValue = @"";
  confirmField.stringValue = @"";

  if (password.length == 0 || ![password isEqualToString:confirmation]) {
    password = nil;
    confirmation = nil;
    return {false, "invalid_password"};
  }

  NativePasswordResult result = StoreCustomPassword(password);
  password = nil;
  confirmation = nil;
  return result;
}

void StartCustomPasswordChange(AuthBaton *baton) {
  LAContext *context = [[LAContext alloc] init];
  NSError *canEvaluateError = nil;
  if (![context canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication
                             error:&canEvaluateError]) {
    ResolveBaton(baton, false, MapLAErrorCode(canEvaluateError).UTF8String);
    return;
  }

  NSString *reason = [NSString stringWithUTF8String:baton->input.reason.c_str()];
  [context evaluatePolicy:LAPolicyDeviceOwnerAuthentication
          localizedReason:reason
                    reply:^(BOOL success, NSError *error) {
                      dispatch_async(dispatch_get_main_queue(), ^{
                        [context invalidate];
                        if (!success) {
                          ResolveBaton(
                              baton,
                              false,
                              MapLAErrorCode(error).UTF8String);
                          return;
                        }

                        NSView *electronView =
                            ViewFromNativeHandle(baton->input.nativeWindowHandle);
                        NSWindow *window = electronView.window;
                        NativePasswordResult result =
                            PromptForNewCustomPassword(window);
                        ResolveBaton(baton, result.ok, result.code);
                      });
                    }];
}

void ExecuteAuth(napi_env /* env */, void *data) {
  AuthBaton *baton = reinterpret_cast<AuthBaton *>(data);
  RunOnMainSync(^{
    if (baton->mode == AuthMode::Embedded) {
      StartEmbeddedAuth(baton);
    } else if (baton->mode == AuthMode::Modal) {
      StartModalAuth(baton);
    } else {
      StartCustomPasswordChange(baton);
    }
  });

  dispatch_semaphore_wait(baton->semaphore, DISPATCH_TIME_FOREVER);
}

void CompleteAuth(napi_env env, napi_status status, void *data) {
  AuthBaton *baton = reinterpret_cast<AuthBaton *>(data);
  if (status != napi_ok && !baton->resolved) {
    baton->ok = false;
    baton->code = "native_addon_failed";
  }

  napi_value result = MakeResult(env, baton->ok, baton->code.c_str());
  napi_resolve_deferred(env, baton->deferred, result);
  napi_delete_async_work(env, baton->work);
  delete baton;
}

napi_value CreateAuthPromise(napi_env env, AuthInput input, AuthMode mode) {
  napi_value promise;
  napi_deferred deferred;
  napi_create_promise(env, &deferred, &promise);

  AuthBaton *baton = new AuthBaton();
  baton->env = env;
  baton->deferred = deferred;
  baton->mode = mode;
  baton->input = std::move(input);
  baton->semaphore = dispatch_semaphore_create(0);

  napi_value workName;
  napi_create_string_utf8(env, "native-auth", NAPI_AUTO_LENGTH, &workName);
  napi_create_async_work(env, nullptr, workName, ExecuteAuth, CompleteAuth, baton, &baton->work);
  napi_queue_async_work(env, baton->work);

  return promise;
}

napi_value Show(napi_env env, napi_callback_info info) {
  AuthInput input;
  if (!ReadInput(env, info, &input, true)) {
    return MakeResult(env, false, "invalid_payload");
  }

  return CreateAuthPromise(env, input, AuthMode::Embedded);
}

napi_value Authenticate(napi_env env, napi_callback_info info) {
  AuthInput input;
  if (!ReadInput(env, info, &input, false)) {
    return MakeResult(env, false, "invalid_payload");
  }

  return CreateAuthPromise(env, input, AuthMode::Modal);
}

napi_value ChangeCustomPassword(napi_env env, napi_callback_info info) {
  AuthInput input;
  if (!ReadInput(env, info, &input, false)) {
    return MakeResult(env, false, "invalid_payload");
  }

  return CreateAuthPromise(env, input, AuthMode::CustomPasswordChange);
}

napi_value GetConsoleUsername(napi_env env, napi_callback_info /* info */) {
  uid_t uid = 0;
  NSString *username = CurrentConsoleUsername(&uid);
  if (!username) {
    return MakeResult(env, false, "user_not_found");
  }

  napi_value result = MakeResult(env, true, "success");
  napi_value usernameValue;
  napi_create_string_utf8(env, username.UTF8String, NAPI_AUTO_LENGTH, &usernameValue);
  napi_set_named_property(env, result, "username", usernameValue);
  return result;
}

napi_value HasCustomPasswordConfigured(napi_env env, napi_callback_info /* info */) {
  napi_value result = MakeResult(env, true, "success");
  napi_value configuredValue;
  napi_get_boolean(env, HasCustomPassword(), &configuredValue);
  napi_set_named_property(env, result, "configured", configuredValue);
  return result;
}

napi_value Update(napi_env env, napi_callback_info info) {
  AuthInput input;
  if (!ReadInput(env, info, &input, true)) {
    return MakeResult(env, false, "invalid_payload");
  }

  __block bool updated = false;
  RunOnMainSync(^{
    NSString *key = SessionKey(input.nativeWindowHandle, input.noteId);
    RecallNativeAuthSession *session = Sessions()[key];
    if (session) {
      NSView *electronView = ViewFromNativeHandle(input.nativeWindowHandle);
      NSWindow *window = electronView.window;
      NSView *hostView = window.contentView ?: electronView;
      session.authMethod = [NSString stringWithUTF8String:input.authMethod.c_str()];
      session.passwordPlaceholder =
          [NSString stringWithUTF8String:input.passwordPlaceholder.c_str()];
#if RECALL_HAS_EMBEDDED_AUTH_UI
      if (session.container) {
        session.container.frame = RectInAppKitPoints(input.rect, window);
        session.clipView.frame = session.container.bounds;
        session.clipView.layer.cornerRadius =
            MIN(session.clipView.bounds.size.width, session.clipView.bounds.size.height) /
            2.0;
        session.view.frame = session.clipView.bounds;
        session.badgeView.frame = session.clipView.bounds;
        [session.badgeView setNeedsDisplay:YES];
      }
#endif
      UpdatePasswordOverlay(session, PasswordFrameForInput(input, window, hostView));
      if (session.passwordField.stringValue.length == 0) {
        SetPasswordPlaceholder(session, session.passwordPlaceholder);
      }
      updated = true;
    }
  });

  return MakeResult(env, true, updated ? "success" : "success");
}

napi_value Hide(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok ||
      argc < 1) {
    return MakeResult(env, true, "success");
  }

  AuthInput input;
  ReadOptionalString(env, args[0], "noteId", &input.noteId);
  ReadNativeWindowHandle(env, args[0], &input.nativeWindowHandle);

  RunOnMainSync(^{
    HideSessions(input.nativeWindowHandle, input.noteId);
  });

  return MakeResult(env, true, "success");
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor descriptors[] = {
      {"show", nullptr, Show, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"update", nullptr, Update, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"hide", nullptr, Hide, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"authenticate", nullptr, Authenticate, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"changeCustomPassword", nullptr, ChangeCustomPassword, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"getConsoleUsername", nullptr, GetConsoleUsername, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"hasCustomPasswordConfigured", nullptr, HasCustomPasswordConfigured, nullptr, nullptr, nullptr, napi_default, nullptr},
  };

  napi_define_properties(
      env, exports, sizeof(descriptors) / sizeof(descriptors[0]), descriptors);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
