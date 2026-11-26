# 0008: Admin drawers work without JavaScript and re-render in place

- **Status:** accepted
- **Date:** 2026-11-26

## Context

The guest ledger's add, edit and reply drawers (`src/pages/admin/guests.astro`,
`src/pages/admin/rsvps.astro`, `src/components/admin/GuestHouseholdForm.astro`,
the drawer blocks in `src/styles/admin.css`) post plain forms. A script improves
them, but every action must still work when the script has not run. These rules
lived in code comments until ADR 0002.

## Decision

- **No-JS paths stay real.** Each JS improvement has a form-post twin:
  - "Remove open seat" without JS submits `remove_seat=<id>` and comes back as a
    draft without that seat; with JS the row is removed in place. Both paths
    carry the ids already removed as `removed_seat` and have already taken the
    seat off `seat_count`, so the save counts it once and still runs when
    `removed_seat` is present.
  - The no-JS "Add" button is hidden once the script owns Enter.
  - A confirmation stays in the draft with JS; its submit is the no-JS path.
  - On `rsvps.astro`, the size select stays enabled without JS, so an unticked
    seat can post a size; that seat is not coming, so the size is dropped, not
    refused.
  - Without JS nothing measures, so the last rows' row menus open upward to
    clear the phone tab bar (`admin.css`, row menu).
- **A re-rendered drawer is the same drawer.** A POST re-render, or the redirect
  after Save and add another, continues the drawer the host already had open, so
  it shows in place without sliding in. Closing still plays its exit.
- **A refused save starts dirty.** A drawer the server re-rendered after a
  refused save holds a draft that was never stored. Read that state before
  `sync()`, which shows the duplicate warning for any shared name, refused or not.
  A refusal shows inside the open edit or new row, above its bottom line; any
  other failure (an archive, a failed load) keeps the page-level notice.
- **Discard is asked once.** Callers confirm a dirty discard before closing;
  `popstate` has already asked. Back from a dirty edit asks first, and keeping the
  edit puts its URL back. When the host says OK to discarding on a link that
  leaves the page, a flag stops `beforeunload` asking a second time; new typing
  clears it, and so does showing the page again. After a discard the next drawer
  starts clean, since its stepper and switch changes fire no `input` event to clear
  the flag. The CSV link downloads without leaving the page, so it is not guarded.
- **Exits are owned by their drawer.** A reopen mid-exit has already removed the
  old drawer; its exit timer must not unlock the page or stop tracking under the
  new one.
- **Late forms are delegated.** The RSVP edit form can arrive later through the
  drawer swap, so its change listener is delegated and every swap re-syncs the
  form it brings in.
- **Layout measures, not boxes.** The row-menu popover is placed by its layout
  height, not its painted box: the entrance scales it from the top, so its painted
  bottom is short of where it settles. Opening grows out of the button and
  closing is instant, since only the open state carries a transition. It animates
  `scale`, not `transform`, so the centring `translate` keeps working, and the
  closed `details` holds the from values because `@starting-style` never applies
  to content kept styled by `content-visibility`.

## Consequences

- A change to a drawer is tested with and without JS (`tests/admin*.spec.ts`).
- New drawer behaviour adds its no-JS twin in the same change.
