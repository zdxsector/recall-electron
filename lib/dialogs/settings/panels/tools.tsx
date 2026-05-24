import React, { FunctionComponent, Fragment, useState } from 'react';
import { connect } from 'react-redux';

import actions from '../../../state/actions';
import PanelTitle from '../../../components/panel-title';
import ButtonGroup from '../../button-group';
import RadioGroup from '../../radio-settings-group';
import SettingsGroup, { Item } from '../../settings-group';
import { showDialog } from '../../../state/ui/actions';
import ToggleGroup from '../../toggle-settings-group';
import { isElectron, isMac } from '../../../utils/platform';
import { viewExternalUrl } from '../../../utils/url-utils';

import * as S from '../../../state';
import * as T from '../../../types';

type StateProps = {
  keyboardShortcuts: boolean;
  lockedNotesPasswordMode: T.LockedNotesPasswordMode;
  lockedNotesUseTouchId: boolean;
  sendNotifications: boolean;
};

type DispatchProps = {
  exportNotes: () => any;
  requestNotifications: (sendNotifications: boolean) => any;
  setLockedNotesPasswordMode: (mode: T.LockedNotesPasswordMode) => any;
  setLockedNotesUseTouchId: (useTouchId: boolean) => any;
  showAbout: () => any;
  showImportDialog: () => any;
  showKeybindings: () => any;
  toggleShortcuts: () => any;
};

type Props = DispatchProps & StateProps;
const SettingsItem = Item as React.ComponentType<{
  slug: string;
  title: string;
}>;

export const ToolsPanel: FunctionComponent<Props> = ({
  exportNotes,
  keyboardShortcuts,
  lockedNotesPasswordMode,
  lockedNotesUseTouchId,
  requestNotifications,
  sendNotifications,
  setLockedNotesPasswordMode,
  setLockedNotesUseTouchId,
  showAbout,
  showImportDialog,
  showKeybindings,
  toggleShortcuts,
}) => {
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);

  const onSelectItem = (item: { slug: string }) => {
    if (item.slug === 'import') {
      showImportDialog();
    } else if (item.slug === 'export') {
      exportNotes();
    }
  };

  const changeLockedNotesPassword = async () => {
    if (
      !isElectron ||
      !isMac ||
      typeof window.electron?.secureNotes?.lockedNotes?.changePassword !==
        'function'
    ) {
      setPasswordStatus('Locked notes password changes are unavailable.');
      return false;
    }

    setPasswordStatus('Authenticate to change the note password.');
    const result = await window.electron.secureNotes.lockedNotes.changePassword(
      {
        reason: 'Change the password used for locked notes',
      }
    );
    if (result?.ok) {
      setLockedNotesPasswordMode('custom');
      setPasswordStatus('Note password updated.');
      return true;
    }

    if (result?.code === 'cancelled' || result?.error === 'cancelled') {
      setPasswordStatus(null);
      return false;
    }

    setPasswordStatus('Could not update the note password.');
    return false;
  };

  const onLockedNotesPasswordModeChange = async (slug: string) => {
    if (slug === 'login') {
      setLockedNotesPasswordMode('login');
      setPasswordStatus(null);
      return;
    }

    if (slug !== 'custom') {
      return;
    }

    const status =
      typeof window.electron?.secureNotes?.lockedNotes?.hasCustomPassword ===
      'function'
        ? await window.electron.secureNotes.lockedNotes.hasCustomPassword()
        : { ok: false, configured: false };

    if (status?.configured) {
      setLockedNotesPasswordMode('custom');
      setPasswordStatus(null);
      return;
    }

    await changeLockedNotesPassword();
  };

  return (
    <Fragment>
      <div className="settings-tools">
        <PanelTitle headingLevel={3}>Tools</PanelTitle>
        <ButtonGroup
          items={[
            {
              name: 'Import Notes',
              slug: 'import',
            },
            {
              name: 'Export Notes',
              slug: 'export',
            },
          ]}
          onClickItem={onSelectItem}
        />
      </div>
      <SettingsGroup
        slug="keyboardShortcuts"
        activeSlug={keyboardShortcuts ? 'keyboardShortcuts' : ''}
        onChange={toggleShortcuts}
        renderer={ToggleGroup}
      >
        <SettingsItem title="Keyboard Shortcuts" slug="keyboardShortcuts" />
      </SettingsGroup>

      <SettingsGroup
        title="Locked notes"
        slug="lockedNotesPasswordMode"
        activeSlug={lockedNotesPasswordMode}
        onChange={onLockedNotesPasswordModeChange}
        renderer={RadioGroup}
      >
        <SettingsItem title="Use Login Password" slug="login" />
        <SettingsItem title="Use Custom Password" slug="custom" />
      </SettingsGroup>

      <div className="settings-locked-notes-actions">
        <button
          type="button"
          className="settings-link-item"
          onClick={changeLockedNotesPassword}
        >
          Change Password
        </button>
        {passwordStatus && <p>{passwordStatus}</p>}
      </div>

      <SettingsGroup
        slug="lockedNotesUseTouchId"
        activeSlug={lockedNotesUseTouchId ? 'useTouchId' : ''}
        onChange={() => setLockedNotesUseTouchId(!lockedNotesUseTouchId)}
        renderer={ToggleGroup}
      >
        <SettingsItem title="Use Touch ID" slug="useTouchId" />
      </SettingsGroup>

      <SettingsGroup
        slug="allowNotifications"
        activeSlug={sendNotifications ? 'allowNotifications' : ''}
        onChange={() => requestNotifications(!sendNotifications)}
        renderer={ToggleGroup}
      >
        <SettingsItem
          title="Notify on remote changes"
          slug="allowNotifications"
        />
      </SettingsGroup>

      <div className="settings-links">
        <button
          type="button"
          className="settings-link-item"
          onClick={showKeybindings}
        >
          Keyboard Shortcuts
        </button>
        <button
          type="button"
          className="settings-link-item"
          onClick={() => viewExternalUrl('https://slybacalso.me')}
        >
          slybacalso.me
        </button>
        <button
          type="button"
          className="settings-link-item"
          onClick={showAbout}
        >
          About
        </button>
      </div>
    </Fragment>
  );
};

const mapStateToProps: S.MapState<StateProps> = ({
  settings: {
    keyboardShortcuts,
    lockedNotesPasswordMode,
    lockedNotesUseTouchId,
    sendNotifications,
  },
}) => ({
  keyboardShortcuts,
  lockedNotesPasswordMode,
  lockedNotesUseTouchId,
  sendNotifications,
});

const mapDispatchToProps: S.MapDispatch<DispatchProps> = {
  exportNotes: () => actions.data.exportNotes(),
  requestNotifications: (sendNotifications) => ({
    type: 'REQUEST_NOTIFICATIONS',
    sendNotifications,
  }),
  setLockedNotesPasswordMode: actions.settings.setLockedNotesPasswordMode,
  setLockedNotesUseTouchId: actions.settings.setLockedNotesUseTouchId,
  showAbout: () => showDialog('ABOUT'),
  showImportDialog: () => showDialog('IMPORT'),
  showKeybindings: () => showDialog('KEYBINDINGS'),
  toggleShortcuts: () => actions.settings.toggleKeyboardShortcuts(),
};

export default connect(mapStateToProps, mapDispatchToProps)(ToolsPanel);
