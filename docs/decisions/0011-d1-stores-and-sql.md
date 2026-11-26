# 0011: D1 stores write ordered history, hand-written SQL, and a matching fake

- **Status:** accepted
- **Date:** 2026-11-26

## Context

The RSVP, song and admin stores run on D1 in production and on a fake store on
previews and in tests (`RSVP_STORE`, ADR 0012). Reply history, the dashboard
counts and the song cap depend on choices a reader cannot see in the code. Before
ADR 0002 they lived as comments in `src/lib/admin/d1.ts`, `src/lib/rsvp/d1.ts`,
`src/lib/db/summary.ts`, `src/lib/songs/store.ts` and `src/lib/admin/fake.ts`.

## Decision

### Response ids and history

- A guest reply (`createD1RsvpStore` in `src/lib/rsvp/d1.ts`) takes
  `responseId = Date.now() * 1000 + random(0..999)`. A clash needs two
  submissions in the same millisecond with the same suffix; the `responses`
  primary key then rejects the insert rather than overwriting history.
- History orders by `submitted_at DESC, id DESC`. Two saves in the same
  millisecond share `submitted_at`, so the id breaks the tie. A host edit
  (`saveRsvp` in `src/lib/admin/d1.ts`) therefore takes the larger of the
  clock id and `max(id) + 1` for the household, so the new reply always sorts
  after every earlier one.

### Host edits

- A host rename in `saveRsvp` sets only `invite_seats.name` (and its `named_by*` columns).
  `name_key` and `surname_key` follow the invited name, which guest lookup uses
  (ADR 0013), so a host rename never changes how a guest finds the invite.
- Household edits (`saveHousehold`) are guarded by an optimistic token. The first statement of the
  D1 batch is `UPDATE households SET updated_at=CASE WHEN updated_at=? THEN ?
  ELSE NULL END`. A stale token sets the `NOT NULL` column to `NULL`, SQLite
  fails, and D1 rolls back the whole batch. It must stay the first statement, so
  nothing in the batch runs before the check.

### Hand-written SQL

Drizzle is the default; these queries are raw `sql` on purpose:

- `getHouseholdSummary` (`src/lib/db/summary.ts`): the correlated
  newest-response CTE and its indexed dashboard aggregates are one SQLite query,
  which Drizzle cannot express.
- `getUnnamedPlusOneCount`: a separate, focused count, so D1 starts at the
  `(kind, name)` index and probes only the newest response for each unnamed
  plus-one instead of building the whole summary.
- `getPlusOneStates`: the newest-response anti-join stays SQL so SQLite uses the
  household/submitted-at index for each plus-one.
- `createD1SongStore.add` (`src/lib/songs/store.ts`): the song cap (500 songs,
  20 per guest) is one conditional `INSERT ... SELECT ... WHERE`, so the check and
  the write are atomic. Drizzle cannot express it.

### The fake matches D1

`createFakeAdminStore` (`src/lib/admin/fake.ts`) gives the same answers as the
D1 store:

- `getSlipperOrder` takes sizes from each household's newest reply.
- Song requests list newest first (`created_at desc, id desc`).
- `unnamedPlusOnes` counts seats, not households, and never a declined
  household's seat, as `getUnnamedPlusOneCount` does.

## Consequences

- A change to how history sorts, or a new writer to `responses`, keeps ids
  increasing within a household.
- A new statement in the household edit batch goes after the token check.
- Replacing a raw query with Drizzle needs the same plan (`EXPLAIN QUERY PLAN`)
  and the D1 budget test (`d1-budget.test.ts`) to hold.
- A change to a D1 count or order changes the fake in the same PR, and the other
  way round.
