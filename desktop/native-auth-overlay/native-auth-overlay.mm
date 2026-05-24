#include <node_api.h>

#import <AppKit/AppKit.h>
#import <LocalAuthentication/LocalAuthentication.h>

#if __has_include(<LocalAuthenticationEmbeddedUI/LAAuthenticationView.h>)
#import <LocalAuthenticationEmbeddedUI/LAAuthenticationView.h>
#define RECALL_HAS_EMBEDDED_AUTH_UI 1
#else
#define RECALL_HAS_EMBEDDED_AUTH_UI 0
#endif

#include <dispatch/dispatch.h>
#include <cstring>
#include <string>
#include <vector>

namespace {

struct AuthRect {
  double x = 0;
  double y = 0;
  double width = 0;
  double height = 0;
  double scaleFactor = 1;
};

struct AuthInput {
  uintptr_t nativeWindowHandle = 0;
  std::string noteId;
  std::string reason = "View this locked note in Recall";
  AuthRect rect;
  bool debug = false;
};

enum class AuthMode {
  Embedded,
  Modal,
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

  if (needsRect &&
      (!ReadNativeWindowHandle(env, args[0], &input->nativeWindowHandle) ||
       !ReadRect(env, args[0], &input->rect))) {
    return false;
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

}  // namespace

@interface RecallNativeAuthSession : NSObject
@property(nonatomic) uintptr_t nativeWindowHandle;
@property(nonatomic, copy) NSString *noteId;
@property(nonatomic, copy) NSString *key;
@property(nonatomic, strong) LAContext *context;
#if RECALL_HAS_EMBEDDED_AUTH_UI
@property(nonatomic, strong) NSView *container;
@property(nonatomic, strong) NSView *clipView;
@property(nonatomic, strong) LAAuthenticationView *view;
#endif
@property(nonatomic) void *baton;
@property(nonatomic) BOOL completed;
@property(nonatomic) BOOL debug;
@end

@implementation RecallNativeAuthSession
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
    session.view = nil;
  }
#endif
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

void StartEmbeddedAuth(AuthBaton *baton) {
#if RECALL_HAS_EMBEDDED_AUTH_UI
  if (@available(macOS 12.0, *)) {
    Class authViewClass = NSClassFromString(@"LAAuthenticationView");
    if (!authViewClass) {
      DebugLog(baton->input, "native-auth: embedded view unavailable");
      ResolveBaton(baton, false, "embedded_ui_unavailable");
      return;
    }

    NSView *electronView = ViewFromNativeHandle(baton->input.nativeWindowHandle);
    NSWindow *window = electronView.window;
    NSView *hostView = window.contentView ?: electronView;
    if (!hostView || !window) {
      DebugLog(baton->input, "native-auth: embedded view unavailable");
      ResolveBaton(baton, false, "embedded_ui_unavailable");
      return;
    }

    LAContext *context = [[LAContext alloc] init];
    context.localizedFallbackTitle = @"";

    NSError *canEvaluateError = nil;
    if (![context canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
                               error:&canEvaluateError]) {
      DebugLog(baton->input, "native-auth: embedded view unavailable");
      ResolveBaton(baton, false, MapLAErrorCode(canEvaluateError).UTF8String);
      return;
    }

    FinishExistingSession(baton->input.nativeWindowHandle, baton->input.noteId);

    RecallNativeAuthSession *session = [[RecallNativeAuthSession alloc] init];
    session.nativeWindowHandle = baton->input.nativeWindowHandle;
    session.noteId = [NSString stringWithUTF8String:baton->input.noteId.c_str()];
    session.key = SessionKey(baton->input.nativeWindowHandle, baton->input.noteId);
    session.context = context;
    session.baton = baton;
    session.debug = baton->input.debug;

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
    clipView.layer.backgroundColor = [NSColor colorWithCalibratedWhite:0.12 alpha:1.0].CGColor;
    clipView.layer.cornerRadius =
        MIN(clipView.bounds.size.width, clipView.bounds.size.height) / 2.0;
    clipView.layer.masksToBounds = YES;
    clipView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;

    LAAuthenticationView *view =
        [[LAAuthenticationView alloc] initWithContext:context controlSize:NSControlSizeRegular];
    view.frame = clipView.bounds;
    view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [clipView addSubview:view];
    [container addSubview:clipView];
    [hostView addSubview:container positioned:NSWindowAbove relativeTo:nil];
    session.container = container;
    session.clipView = clipView;
    session.view = view;
    Sessions()[session.key] = session;

    DebugLog(baton->input, "native-auth: embedded view attached");

    NSString *reason = [NSString stringWithUTF8String:baton->input.reason.c_str()];
    dispatch_async(dispatch_get_main_queue(), ^{
      if (session.completed) {
        return;
      }

      [context evaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
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
    return;
  }
#endif

  DebugLog(baton->input, "native-auth: embedded view unavailable");
  ResolveBaton(baton, false, "embedded_ui_unavailable");
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

void ExecuteAuth(napi_env /* env */, void *data) {
  AuthBaton *baton = reinterpret_cast<AuthBaton *>(data);
  RunOnMainSync(^{
    if (baton->mode == AuthMode::Embedded) {
      StartEmbeddedAuth(baton);
    } else {
      StartModalAuth(baton);
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
#if RECALL_HAS_EMBEDDED_AUTH_UI
      NSView *electronView = ViewFromNativeHandle(input.nativeWindowHandle);
      NSWindow *window = electronView.window;
      session.container.frame = RectInAppKitPoints(input.rect, window);
      session.clipView.frame = session.container.bounds;
      session.clipView.layer.cornerRadius =
          MIN(session.clipView.bounds.size.width, session.clipView.bounds.size.height) /
          2.0;
      session.view.frame = session.clipView.bounds;
#endif
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
  };

  napi_define_properties(
      env, exports, sizeof(descriptors) / sizeof(descriptors[0]), descriptors);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
