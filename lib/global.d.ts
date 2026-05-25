import { TKQItem, TracksAPI } from './analytics/types';
import { compose } from 'redux';

import * as S from './state';

declare module '*.css';
declare module '*.scss';
declare module '*.png';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.gif';
declare module '*.webp';
declare module '*.svg';
declare module '*.ttf';
declare module '*.woff';
declare module '*.woff2';
declare module '*.eot';

type ElectronBridge = {
  isMac: boolean;
  isLinux: boolean;
  isWindows: boolean;
  send: (channel: string, data?: unknown) => void;
  receive: (channel: string, callback: (...args: any[]) => void) => void;
  removeListener: (channel: string) => void;
  encryptNoteContent: (args: { content: string }) => Promise<{
    ok: boolean;
    encryptedContent?: string;
    lockedAt?: number;
    error?: string;
  }>;
  decryptNoteContent: (args: {
    noteId?: string;
    encryptedContent: string;
    reason?: string;
  }) => Promise<{
    ok: boolean;
    content?: string;
    error?: string;
    cancelled?: boolean;
  }>;
  secureNotes: {
    nativeAuth: {
      show: (args: NativeAuthOverlayPayload) => Promise<NativeAuthResult>;
      update: (args: NativeAuthOverlayPayload) => Promise<NativeAuthResult>;
      hide: (args: { noteId?: string }) => Promise<NativeAuthResult>;
    };
    systemAuth: {
      unlock: (args: {
        allowModalFallback?: boolean;
        noteId: string;
        encryptedContent: string;
        reason?: string;
      }) => Promise<{
        ok: boolean;
        code?: string;
        content?: string;
        error?: string;
      }>;
    };
    lockedNotes: {
      getLoginUsername: () => Promise<{
        ok: boolean;
        code?: string;
        error?: string;
        username?: string;
      }>;
      hasCustomPassword: () => Promise<{
        ok: boolean;
        code?: string;
        configured?: boolean;
        error?: string;
      }>;
      changePassword: (args?: { reason?: string }) => Promise<NativeAuthResult>;
    };
    test: {
      getEvents: () => Promise<
        Array<{
          event: string;
          payload: { noteId?: string; code?: string; kind?: string };
          timestamp: number;
        }>
      >;
    };
  };
  loadPersistentState: () => any;
  savePersistentState: (data: any) => void;
  loadAllRevisions: () => any;
  saveNoteRevisions: (noteId: any, revisions: any) => void;
  saveNoteAssetFromDataUrl: (
    args: any
  ) => Promise<{ rel: string; fileUrl: string } | null>;
  saveNoteAssetFromBuffer: (
    args: any
  ) => Promise<{ rel: string; fileUrl: string } | null>;
  saveNoteAssetFromUrl: (
    args: any
  ) => Promise<{ rel: string; fileUrl: string } | null>;
  resolveNoteAssetFileUrl: (args: any) => string | null;
  readClipboardImageDataUrl: () => string | null;
  // Window control functions for custom title bar (Windows)
  windowMinimize: () => void;
  windowMaximize: () => void;
  windowClose: () => void;
  windowIsMaximized: () => Promise<boolean>;
  setTitleBarOverlay: (overlay: {
    color?: string;
    symbolColor?: string;
    height?: number;
  }) => void;
  onWindowMaximized: (callback: (isMaximized: boolean) => void) => () => void;
};

type NativeAuthOverlayPayload = {
  authMethod?: 'login' | 'custom';
  noteId: string;
  passwordPlaceholder?: string;
  reason?: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  passwordRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  viewportHeight: number;
  devicePixelRatio: number;
  useTouchId?: boolean;
};

type NativeAuthResult = {
  ok: boolean;
  code?: string;
  error?: string;
};

declare global {
  const __TEST__: boolean;
  const config: {
    app_engine_url: string;
    app_id: string;
    app_key: string;
    development: boolean;
    is_app_engine: string;
    version: string;
    wpcc_client_id: string;
    wpcc_redirect_url: string;
  };

  interface Window {
    __REDUX_DEVTOOLS_EXTENSION_COMPOSE__?: typeof compose;
    analyticsEnabled: boolean;
    electron: ElectronBridge;
    location: Location;
    testEvents: (string | [string, ...any[]])[];
    _tkq: TKQItem[] & { a: unknown };
    webConfig?: {
      signout?: (callback: () => void) => void;
    };
    wpcom: {
      tracks: TracksAPI;
    };
  }
}
