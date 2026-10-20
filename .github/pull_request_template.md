## What changed

<!-- One or two sentences. Link the issue: Closes #123 -->

## Why

<!-- The problem this solves, and why this approach. -->

## How it was tested

<!-- Commands you ran, and any behaviour you checked by hand. -->

- [ ] `npm run verify` passes locally
- [ ] `npm run format:check` passes
- [ ] New behaviour has a test (or a note explaining why it cannot)
- [ ] No secrets, tokens or real personal data in the diff or in logs
- [ ] No new paid dependency or paid tier

## Risk

- [ ] Touches auth, the BFF, HMAC signing, uploads, rate limits or the database

If you ticked the last box, add a short threat-model note: what an attacker gains
if this is wrong, and which tests cover it.

## Screenshots

<!-- For UI changes only. Light and dark theme if the page supports both. -->
