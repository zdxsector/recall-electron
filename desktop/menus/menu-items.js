const { app } = require('electron');

const { appCommandSender } = require('./utils');
const updater = require('../updater');
const { autoUpdater } = require('electron-updater');

const about = {
  label: '&zdxsector ' + app.name,
};

const checkForUpdates = {
  label: '&Check for Updates…',
  enabled: autoUpdater.isUpdaterActive(),
  click: updater.pingAndShowProgress.bind(updater),
};

const emptyTrash = (isAuthenticated) => {
  return {
    label: '&Empty Trash',
    visible: isAuthenticated,
    click: appCommandSender({ action: 'emptyTrash' }),
  };
};

const settings = (isAuthenticated, openSettingsWindow) => {
  return {
    id: 'settings',
    label: 'Settings…',
    visible: isAuthenticated,
    accelerator: 'CommandOrControl+,',
    click:
      typeof openSettingsWindow === 'function'
        ? openSettingsWindow
        : appCommandSender({
            action: 'showDialog',
            dialog: 'SETTINGS',
          }),
  };
};

const signout = (isAuthenticated) => {
  return {
    label: '&Sign Out',
    visible: isAuthenticated,
    click: appCommandSender({
      action: 'logout',
    }),
  };
};

module.exports = {
  about,
  checkForUpdates,
  emptyTrash,
  preferences: settings,
  settings,
  signout,
};
