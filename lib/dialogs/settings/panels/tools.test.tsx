import React from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('../../../utils/platform', () => ({
  isElectron: true,
  isMac: true,
}));

jest.mock('../../../utils/url-utils', () => ({
  viewExternalUrl: jest.fn(),
}));

import { ToolsPanel } from './tools';

const baseProps = {
  exportNotes: jest.fn(),
  keyboardShortcuts: true,
  lockedNotesPasswordMode: 'login' as const,
  lockedNotesUseTouchId: true,
  requestNotifications: jest.fn(),
  sendNotifications: false,
  setLockedNotesPasswordMode: jest.fn(),
  setLockedNotesUseTouchId: jest.fn(),
  showAbout: jest.fn(),
  showImportDialog: jest.fn(),
  showKeybindings: jest.fn(),
  toggleShortcuts: jest.fn(),
};

const setupElectron = ({
  changePasswordResult = { ok: true, code: 'success' },
  configured = false,
} = {}) => {
  const changePassword = jest.fn().mockResolvedValue(changePasswordResult);
  const hasCustomPassword = jest.fn().mockResolvedValue({
    ok: true,
    code: 'success',
    configured,
  });

  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      secureNotes: {
        lockedNotes: {
          changePassword,
          hasCustomPassword,
        },
      },
    },
  });

  return { changePassword, hasCustomPassword };
};

describe('ToolsPanel locked notes settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupElectron();
  });

  it('renders locked note mode options, change password, and Touch ID toggle', () => {
    const tree = renderer.create(<ToolsPanel {...baseProps} />);
    const json = JSON.stringify(tree.toJSON());

    expect(json).toMatch(/Locked notes/);
    expect(json).toMatch(/Use Login Password/);
    expect(json).toMatch(/Use Custom Password/);
    expect(json).toMatch(/Change Password/);
    expect(json).toMatch(/Use Touch ID/);
    expect(
      tree.root.findByProps({
        id: 'settings-field-lockedNotesPasswordMode-login',
      }).props.checked
    ).toBe(true);
    expect(
      tree.root.findByProps({
        id: 'settings-field-lockedNotesUseTouchId-useTouchId',
      }).props.checked
    ).toBe(true);
  });

  it('selects custom mode immediately when a custom password exists', async () => {
    const electron = setupElectron({ configured: true });
    const setLockedNotesPasswordMode = jest.fn();
    const tree = renderer.create(
      <ToolsPanel
        {...baseProps}
        setLockedNotesPasswordMode={setLockedNotesPasswordMode}
      />
    );

    await act(async () => {
      tree.root
        .findByProps({ id: 'settings-field-lockedNotesPasswordMode-custom' })
        .props.onChange();
    });

    expect(electron.hasCustomPassword).toHaveBeenCalledTimes(1);
    expect(electron.changePassword).not.toHaveBeenCalled();
    expect(setLockedNotesPasswordMode).toHaveBeenCalledWith('custom');
  });

  it('prompts for a custom password before enabling custom mode', async () => {
    const electron = setupElectron({ configured: false });
    const setLockedNotesPasswordMode = jest.fn();
    const tree = renderer.create(
      <ToolsPanel
        {...baseProps}
        setLockedNotesPasswordMode={setLockedNotesPasswordMode}
      />
    );

    await act(async () => {
      tree.root
        .findByProps({ id: 'settings-field-lockedNotesPasswordMode-custom' })
        .props.onChange();
    });

    expect(electron.hasCustomPassword).toHaveBeenCalledTimes(1);
    expect(electron.changePassword).toHaveBeenCalledWith({
      reason: 'Change the password used for locked notes',
    });
    expect(setLockedNotesPasswordMode).toHaveBeenCalledWith('custom');
  });

  it('change password uses native locked-notes bridge only', async () => {
    const electron = setupElectron({ configured: true });
    const tree = renderer.create(<ToolsPanel {...baseProps} />);

    await act(async () => {
      tree.root
        .findAllByType('button')
        .find((button: { children: React.ReactNode[] }) =>
          button.children.includes('Change Password')
        )!
        .props.onClick();
    });

    expect(electron.changePassword).toHaveBeenCalledWith({
      reason: 'Change the password used for locked notes',
    });
  });

  it('toggles Touch ID setting', () => {
    const setLockedNotesUseTouchId = jest.fn();
    const tree = renderer.create(
      <ToolsPanel
        {...baseProps}
        setLockedNotesUseTouchId={setLockedNotesUseTouchId}
      />
    );

    tree.root
      .findByProps({ id: 'settings-field-lockedNotesUseTouchId-useTouchId' })
      .props.onChange({ currentTarget: { checked: false } });

    expect(setLockedNotesUseTouchId).toHaveBeenCalledWith(false);
  });
});
