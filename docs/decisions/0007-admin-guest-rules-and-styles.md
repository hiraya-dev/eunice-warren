# 0007: Guest list naming rules and the admin stylesheet

- **Status:** accepted
- **Date:** 2026-11-26

## Context

The guest list editor (`src/pages/admin/guests.astro`,
`src/components/admin/GuestHouseholdForm.astro`) suggests an invitation name and
a host ID from the household's members. The admin stylesheet
(`src/styles/admin.css`) sits beside the guest site's styles. Both carried their
rules in comments until ADR 0002.

## Decision

### Names, IDs and seats

- The invitation is addressed to the invited members. A plus-one the guest named
  counts as a seat, never as part of the suggested name or the host ID.
- A new household with no names yet holds one seat for its first name, not a
  plus-one.
- The posted name is compared with the suggestion made from the names that were
  posted, not from the name the same request adds.
- The host ID follows the invitation name, typed or suggested, until the host
  uses Edit ID. An existing household keeps its ID.
- `generateHostId` (`src/lib/admin/names.ts`) makes the host ID from the
  invitation name's surname in capitals plus a two-digit counter: "The Toledo
  Family" → `TOLEDO-01`. Taken IDs are compared without case, and a taken ID
  moves to the next free counter.
- `adminHistoryHeading` (`src/lib/admin/presentation.ts`) leaves out a host edit's
  "by host · email", which the history renders separately so it can be coloured.
- Add has no seat rows: open seats are `seat_count` minus the names. Turning the
  plus-one off also drops open seats added in this draft (they have no row yet);
  the seats left are the rows that remain.
- The last part of a drawer title is set in italic (Paper Admin 11 and 12).

### `src/styles/admin.css`

- Loaded only by `AdminLayout`, so the guest site never ships it.
- It sits outside the cascade layers on purpose: it has to win over the guest
  site's base styles (headings, body, leading trim) that `global.css` brings in for
  the colour and spacing tokens. The dashboard sets its own heading sizes and turns
  off the guest site's pseudo-element trim.
- Mobile first, two breakpoints: 64rem swaps the tab bar for the sidebar and the
  full-screen drawer sheet for a side panel (the guest drawer docks at 37.5rem);
  84rem swaps the stacked cards for the tables.
- Every drawer control sets its own face; the zero-specificity base rule lets each
  part override it.
- Under 64rem the guest drawer is the phone sheet (Paper Admin 13a and 13b). The
  keyboard script in `guests.astro` sets `--guest-sheet-keyboard` and
  `[data-keyboard-open]` on the panel; without it the CSS alone keeps the footer on
  the bottom edge. The sheet waits a beat after the names box loses focus, so the
  tap that blurred it still lands on the control below before the page moves up.
- The RSVP edit form (Paper Admin 15, 15b and 16) keeps the open list's closing
  rule above the note on the drawer ground; L-051 drops it only for list cards.

## Consequences

- A host ID rule change updates this ADR and `tests/admin*.spec.ts` together.
- Moving `admin.css` into a cascade layer means rechecking every heading and trim
  rule on the dashboard.
