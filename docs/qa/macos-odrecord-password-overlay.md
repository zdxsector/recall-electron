# macOS ODRecord Password Overlay QA

Use this checklist on a real macOS device after the `/tmp/verify-current-user-password` proof has passed for both a correct and an incorrect password.

- [ ] macOS version recorded
- [ ] Apple Silicon or Intel hardware recorded
- [ ] Account type recorded: local vs managed/network account
- [ ] Touch ID available path tested
- [ ] Touch ID unavailable path tested
- [ ] Correct current macOS user password unlocks the locked note
- [ ] Wrong current macOS user password keeps the note locked
- [ ] Rapid wrong attempts trigger the native rate limit and do not unlock
- [ ] Native password overlay alignment checked in light mode
- [ ] Native password overlay alignment checked in dark mode
- [ ] Window resize updates Touch ID and password overlay alignment
- [ ] Switching notes removes the password overlay
- [ ] Window close removes the password overlay
- [ ] Packaged app behavior tested
- [ ] Signed/notarized app behavior tested
- [ ] Console.app has no password, password length, hashes, or secret note content

Expected behavior:

- The existing Touch ID / `LAAuthenticationView` overlay still appears.
- The native `NSSecureTextField` password overlay appears beside or below the Touch ID overlay.
- The renderer contains no HTML field for the macOS login password.
- Password success unlocks through the same main-process trusted unlock path as Touch ID.
- Password failure never decrypts or reveals note content.
