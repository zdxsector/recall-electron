// https://github.com/atom/electron/issues/22
export const isElectron = !!window?.electron;

export const isMac = isElectron
  ? window?.electron?.isMac
  : navigator.appVersion.indexOf('Mac') !== -1;

export const isWindows = (() => {
  try {
    // Preload may fail or not provide platform flags; fall back to UA detection.
    if (!!window?.electron) {
      return !!window?.electron?.isWindows || /Win/i.test(navigator.appVersion);
    }
    return /Win/i.test(navigator.appVersion);
  } catch {
    return false;
  }
})();

export const CmdOrCtrl = isElectron && isMac ? 'Cmd' : 'Ctrl';

export const isSafari = /^((?!chrome|android).)*safari/i.test(
  window.navigator.userAgent
);

export const isLinux = isElectron
  ? window?.electron?.isLinux
  : navigator.appVersion.indexOf('Linux') !== -1;
