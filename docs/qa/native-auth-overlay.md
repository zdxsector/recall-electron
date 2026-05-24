# Native Auth Overlay QA

This checklist covers locked notes that use the main-process `NativeAuthService`
boundary. CI uses deterministic mock auth; real Touch ID, macOS password fallback,
and display-specific LAAuthenticationView overlay behavior still require manual
macOS validation.

## Implementation Steps

Steps added after the original implementation step 10:

11. Add NativeAuthService abstraction with real and mock implementations.
12. Add unit tests for payload validation, coordinate conversion, auth result handling, and cleanup.
13. Add IPC integration tests.
14. Add renderer/component tests for the locked-note screen.
15. Add Playwright Electron E2E tests using mock auth mode.
16. Add manual QA checklist for real macOS Touch ID / password fallback behavior.
17. Add security QA checklist.
18. Run typecheck, lint, unit tests, and E2E tests.
19. Fix failures.
20. Document test results and known limitations.

## Test Architecture

- Renderer code calls only `window.electron.secureNotes`.
- Preload exposes narrow methods and calls IPC.
- IPC resolves the caller with `BrowserWindow.fromWebContents(event.sender)`.
- IPC validates `noteId`, auth overlay geometry, and ciphertext payloads.
- Main process delegates auth to `NativeAuthService`.
- `NativeAuthService` uses the bundled native addon in production on macOS.
- The native addon attaches an embedded `LAAuthenticationView` over the
  renderer-provided anchor. It does not show the standard modal prompt in the
  default locked-note path.
- If embedded UI is unavailable, the renderer keeps the note locked and may
  offer an explicit system-auth fallback. Only that explicit fallback may invoke
  modal `evaluatePolicy` authentication.
- Mock auth is enabled only when `SECURE_NOTES_AUTH_MOCK=1` and the app is
  running in `NODE_ENV=test` or `PLAYWRIGHT_TEST=1`.
- Packaged production builds do not default to mock auth.
- Mock auth is a test-only path; it is disabled for packaged production unless
  the process is explicitly running in the test runtime.

Mock result values:

- `SECURE_NOTES_AUTH_MOCK_RESULT=success`
- `SECURE_NOTES_AUTH_MOCK_RESULT=cancel`
- `SECURE_NOTES_AUTH_MOCK_RESULT=failure`
- `SECURE_NOTES_AUTH_MOCK_RESULT=unavailable`
- `SECURE_NOTES_AUTH_MOCK_RESULT=timeout`

Safe test observability is exposed only through the mock/test path. Events may
include `auth-overlay-show`, `auth-overlay-update`, `auth-overlay-hide`,
`auth-result-success`, `auth-result-cancel`, and `auth-result-failure`. Events
must not include note bodies, passwords, ciphertext, encryption keys, or OS
secrets.

## Automated QA

Run:

```sh
pnpm run typecheck
pnpm run lint
pnpm run test:unit
pnpm run test:e2e:auth
```

Automated coverage includes:

- DOM rect to native overlay rect validation.
- top-left DOM coordinate to AppKit-compatible coordinate conversion.
- Retina `devicePixelRatio` handling.
- IPC payload validation.
- `noteId` validation.
- unsupported platform behavior.
- NativeAuthService result handling.
- fallback behavior when the native addon fails to load.
- Embedded-auth success token consumption before decrypting note content.
- locked-note renderer state transitions.
- native overlay cleanup on unmount, note switch, resize, reload, and window close.

## Manual Environment

Record before testing:

- macOS version:
- Mac model:
- Intel or Apple Silicon:
- Touch ID available:
- Touch ID unavailable path tested:
- Xcode version:
- Electron version:
- dev build or packaged build:
- signed build:
- notarized build:

## Manual macOS Test Cases

- Touch ID success unlocks the note.
- Touch ID cancel keeps note locked.
- Password fallback through macOS LocalAuthentication works, if available.
- Repeated cancel does not break future attempts.
- Locked note remains hidden while auth is pending.
- Note content is never visible before successful auth.
- Overlay appears aligned with the HTML anchor.
- Overlay stays aligned after resizing the window.
- Overlay stays aligned after moving between displays.
- Overlay behaves correctly on Retina displays.
- Overlay behaves correctly on non-Retina displays.
- Overlay behaves correctly in light mode.
- Overlay behaves correctly in dark mode.
- Overlay is removed when switching notes.
- Overlay is removed when closing the window.
- Overlay is removed when quitting the app.
- App-specific note password fallback works when configured.
- Wrong app-specific note password does not unlock when configured.
- No HTML input asks for the actual macOS login password.
- App works when Touch ID is unavailable.
- App works when LocalAuthenticationEmbeddedUI is unavailable and fallback is used.
- Packaged, signed, and notarized app still loads the native addon when bundled.
- No relevant errors appear in Console.app.

## Security QA Checklist

- Renderer cannot unlock by mutating React state alone.
- Renderer cannot call arbitrary native addon methods.
- IPC validates all payloads.
- IPC resolves the sender window from `event.sender`.
- IPC does not trust renderer-supplied window IDs.
- Mock auth is unavailable by default in production.
- No secrets are logged.
- No decrypted note content is logged.
- No encryption keys are logged.
- No encryption keys are sent to renderer outside the existing app architecture.
- Native overlay cleanup is reliable.
- Failed native addon load does not expose note contents.
- Unsupported platform does not expose note contents.
- DevTools console commands cannot reveal real locked-note contents without a trusted main-process auth success.

## Acceptance Criteria

- Unit tests pass.
- IPC validation tests pass.
- E2E mock-auth tests pass.
- Manual macOS QA checklist is documented.
- Non-macOS unsupported path is tested.
- Production build does not default to mock auth.
- Native overlay is cleaned up reliably.
- Locked note content is never shown before trusted unlock.
- No HTML field asks for the macOS login password.

## Known Limitations

- `LAAuthenticationView` is available on macOS 12 and newer. Older macOS versions
  or Macs without available biometric authentication use the unavailable path and
  must rely on the explicit modal fallback when appropriate.
- The embedded view path uses biometric authentication. Password fallback is
  handled by the explicit modal `LAPolicyDeviceOwnerAuthentication` path, not by
  an HTML password field.
- Locked notes are authentication-gated with Electron `safeStorage` encrypted
  ciphertext. This is not a separate per-note Keychain item or user-managed
  encryption key store.
- Universal macOS release validation must confirm the bundled `.node` binary
  matches the release architecture and is unpacked from ASAR.
