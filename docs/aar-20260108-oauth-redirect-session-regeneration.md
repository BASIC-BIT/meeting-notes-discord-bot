# AAR: OAuth redirect lost after Discord login

Date: 2026-01-08
Owners: BASIC-BIT, Codex
Status: Complete

## Summary

Users deep linking into the portal were returned to the homepage after Discord OAuth instead of the original deep link. The issue was caused by session regeneration during Passport authentication, which cleared the stored redirect. We fixed the flow by stashing the redirect on the request before Passport runs, then reading it after authentication.

## Impact

- Deep links into `/portal`, `/live`, and `/share` routes did not survive OAuth.
- Users landed on the frontend home page instead of their intended page.

## Root Cause

Passport regenerates the session on OAuth callback. The redirect value was stored in the session and was lost before it could be read in the post-auth handler.

## Detection

- Manual test in local development showed fallback to the homepage.
- Network headers confirmed the session cookie was set, so the redirect loss happened during callback processing.

## Resolution

- Stash the redirect from the session onto the request before `passport.authenticate` runs.
- Read the stashed redirect after authentication and redirect the user to the preserved deep link.

## Prevention

- Added unit tests for redirect stashing behavior.
- Keep redirect logic in a small helper so it is easier to cover with tests.

## Action Items

- Add an integration test around the OAuth callback flow once a test harness is available.
