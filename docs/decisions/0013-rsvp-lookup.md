# 0013: RSVP lookup matches one seat, and guests never see a platform error

- **Status:** accepted
- **Date:** 2026-11-26

## Context

Guests find their invitation by typing their name (no suggestion list, at most one
"Did you mean"). Before ADR 0002 the lookup rules lived as comments in
`src/lib/rsvp/lookup.ts`, `src/lib/rsvp/logic.ts`, `src/actions/index.ts` and
`src/lib/guest.ts`.

## Decision

- `lookupInvite` (`src/lib/rsvp/lookup.ts`) holds the exact and near rules for
  both the fake and the D1 store. An exact name counts only when it identifies one
  household and one seat, so a duplicate name never selects whichever invite SQL
  returned first.
- `findNearGuestName` (`src/lib/rsvp/logic.ts`) returns a suggestion only when
  exactly one distinct, safe near match exists; otherwise the guest gets none.
- Lookup uses `name_key` and `surname_key`, which follow the invited name; a host
  rename does not change them (ADR 0011).
- `guard` in `src/actions/index.ts` catches any platform error from Turnstile or
  the rate limiter and answers with the generic `INTERNAL_SERVER_ERROR` ("Something
  went wrong. Please try again."), so a platform error message never reaches a
  guest. `FORBIDDEN` and `TOO_MANY_REQUESTS` are only for an unverified token or
  an exceeded limit.
- `src/lib/guest.ts` swallows `localStorage` errors: storage may be disabled, and
  the page works without the remembered guest.

## Consequences

- A change to the exact or near rules changes both stores at once, through
  `lookupInvite`.
- A new action reuses the guard rather than passing an error message through.
