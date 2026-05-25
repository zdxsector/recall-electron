#include <node_api.h>

#include <cstdint>
#include <string>
#include <vector>

namespace {

struct SettingsState {
  std::string noteDisplay = "comfy";
  std::string lineLength = "narrow";
  std::string fontSize = "normal";
  std::string sortType = "modificationDate";
  bool sortReversed = false;
  std::string theme = "system";
  bool keyboardShortcuts = true;
  bool sendNotifications = false;
  std::string lockedNotesPasswordMode = "login";
  bool lockedNotesUseTouchId = true;
};

struct ChangeEvent {
  std::string action;
  std::string value;
  std::string sortType;
  bool hasChecked = false;
  bool checked = false;
  bool hasSortReversed = false;
  bool sortReversed = false;
};

using NativeChangeCallback = void (*)(
    const char *action,
    const char *value,
    const char *sortType,
    uint8_t hasChecked,
    uint8_t checked,
    uint8_t hasSortReversed,
    uint8_t sortReversed);

extern "C" void RecallNativeSettingsSetChangeHandler(
    NativeChangeCallback callback);
extern "C" void RecallNativeSettingsShow(
    const char *noteDisplay,
    const char *lineLength,
    const char *fontSize,
    const char *sortType,
    uint8_t sortReversed,
    const char *theme,
    uint8_t keyboardShortcuts,
    uint8_t sendNotifications,
    const char *lockedNotesPasswordMode,
    uint8_t lockedNotesUseTouchId);
extern "C" void RecallNativeSettingsUpdate(
    const char *noteDisplay,
    const char *lineLength,
    const char *fontSize,
    const char *sortType,
    uint8_t sortReversed,
    const char *theme,
    uint8_t keyboardShortcuts,
    uint8_t sendNotifications,
    const char *lockedNotesPasswordMode,
    uint8_t lockedNotesUseTouchId);

napi_threadsafe_function gChangeHandler = nullptr;

std::string SafeString(const char *value) {
  return value ? std::string(value) : "";
}

bool GetProperty(napi_env env, napi_value object, const char *name, napi_value *out) {
  bool hasProperty = false;
  if (napi_has_named_property(env, object, name, &hasProperty) != napi_ok ||
      !hasProperty) {
    return false;
  }

  return napi_get_named_property(env, object, name, out) == napi_ok;
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

SettingsState ReadSettings(napi_env env, napi_value value) {
  SettingsState state;

  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_object) {
    return state;
  }

  ReadOptionalString(env, value, "noteDisplay", &state.noteDisplay);
  ReadOptionalString(env, value, "lineLength", &state.lineLength);
  ReadOptionalString(env, value, "fontSize", &state.fontSize);
  ReadOptionalString(env, value, "sortType", &state.sortType);
  ReadOptionalBool(env, value, "sortReversed", &state.sortReversed);
  ReadOptionalString(env, value, "theme", &state.theme);
  ReadOptionalBool(env, value, "keyboardShortcuts", &state.keyboardShortcuts);
  ReadOptionalBool(env, value, "sendNotifications", &state.sendNotifications);
  ReadOptionalString(
      env,
      value,
      "lockedNotesPasswordMode",
      &state.lockedNotesPasswordMode);
  ReadOptionalBool(
      env,
      value,
      "lockedNotesUseTouchId",
      &state.lockedNotesUseTouchId);

  return state;
}

void SetString(napi_env env, napi_value object, const char *name, const std::string &value) {
  napi_value jsValue;
  napi_create_string_utf8(env, value.c_str(), value.length(), &jsValue);
  napi_set_named_property(env, object, name, jsValue);
}

void SetBool(napi_env env, napi_value object, const char *name, bool value) {
  napi_value jsValue;
  napi_get_boolean(env, value, &jsValue);
  napi_set_named_property(env, object, name, jsValue);
}

void CallChangeHandler(
    napi_env env,
    napi_value jsCallback,
    void *context,
    void *data) {
  ChangeEvent *event = static_cast<ChangeEvent *>(data);
  if (!event) {
    return;
  }

  if (env && jsCallback) {
    napi_value payload;
    napi_create_object(env, &payload);

    SetString(env, payload, "action", event->action);
    if (!event->value.empty()) {
      SetString(env, payload, "value", event->value);
    }
    if (!event->sortType.empty()) {
      SetString(env, payload, "sortType", event->sortType);
    }
    if (event->hasChecked) {
      SetBool(env, payload, "checked", event->checked);
    }
    if (event->hasSortReversed) {
      SetBool(env, payload, "sortReversed", event->sortReversed);
    }

    napi_value global;
    napi_get_global(env, &global);
    napi_call_function(env, global, jsCallback, 1, &payload, nullptr);
  }

  delete event;
}

void Emit(ChangeEvent *event) {
  if (!gChangeHandler) {
    delete event;
    return;
  }

  napi_call_threadsafe_function(gChangeHandler, event, napi_tsfn_nonblocking);
}

void HandleNativeChange(
    const char *action,
    const char *value,
    const char *sortType,
    uint8_t hasChecked,
    uint8_t checked,
    uint8_t hasSortReversed,
    uint8_t sortReversed) {
  ChangeEvent *event = new ChangeEvent();
  event->action = SafeString(action);
  event->value = SafeString(value);
  event->sortType = SafeString(sortType);
  event->hasChecked = hasChecked != 0;
  event->checked = checked != 0;
  event->hasSortReversed = hasSortReversed != 0;
  event->sortReversed = sortReversed != 0;
  Emit(event);
}

void ShowOrUpdate(bool show, const SettingsState &settings) {
  if (show) {
    RecallNativeSettingsShow(
        settings.noteDisplay.c_str(),
        settings.lineLength.c_str(),
        settings.fontSize.c_str(),
        settings.sortType.c_str(),
        settings.sortReversed ? 1 : 0,
        settings.theme.c_str(),
        settings.keyboardShortcuts ? 1 : 0,
        settings.sendNotifications ? 1 : 0,
        settings.lockedNotesPasswordMode.c_str(),
        settings.lockedNotesUseTouchId ? 1 : 0);
    return;
  }

  RecallNativeSettingsUpdate(
      settings.noteDisplay.c_str(),
      settings.lineLength.c_str(),
      settings.fontSize.c_str(),
      settings.sortType.c_str(),
      settings.sortReversed ? 1 : 0,
      settings.theme.c_str(),
      settings.keyboardShortcuts ? 1 : 0,
      settings.sendNotifications ? 1 : 0,
      settings.lockedNotesPasswordMode.c_str(),
      settings.lockedNotesUseTouchId ? 1 : 0);
}

napi_value SetChangeHandler(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  if (gChangeHandler) {
    napi_release_threadsafe_function(gChangeHandler, napi_tsfn_abort);
    gChangeHandler = nullptr;
    RecallNativeSettingsSetChangeHandler(nullptr);
  }

  if (argc < 1) {
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
  }

  napi_valuetype type;
  if (napi_typeof(env, args[0], &type) != napi_ok || type != napi_function) {
    napi_throw_type_error(env, nullptr, "setChangeHandler expects a function");
    return nullptr;
  }

  napi_value resourceName;
  napi_create_string_utf8(
      env,
      "RecallNativeSettingsWindowChangeHandler",
      NAPI_AUTO_LENGTH,
      &resourceName);

  napi_status status = napi_create_threadsafe_function(
      env,
      args[0],
      nullptr,
      resourceName,
      0,
      1,
      nullptr,
      nullptr,
      nullptr,
      CallChangeHandler,
      &gChangeHandler);

  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Could not create settings change handler");
    return nullptr;
  }

  RecallNativeSettingsSetChangeHandler(HandleNativeChange);

  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value Show(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  SettingsState settings;
  if (argc >= 1) {
    settings = ReadSettings(env, args[0]);
  }

  ShowOrUpdate(true, settings);

  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value UpdateSettings(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  SettingsState settings;
  if (argc >= 1) {
    settings = ReadSettings(env, args[0]);
  }

  ShowOrUpdate(false, settings);

  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor descriptors[] = {
    {"setChangeHandler", 0, SetChangeHandler, 0, 0, 0, napi_default, 0},
    {"show", 0, Show, 0, 0, 0, napi_default, 0},
    {"updateSettings", 0, UpdateSettings, 0, 0, 0, napi_default, 0},
  };

  napi_define_properties(
      env,
      exports,
      sizeof(descriptors) / sizeof(descriptors[0]),
      descriptors);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
