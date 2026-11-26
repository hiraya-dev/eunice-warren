# 0004: Specs share one fake store, so they lock, isolate and restore

- **Status:** accepted
- **Date:** 2026-11-26

## Context

Previews and the Playwright server run the fake RSVP and admin store
(`src/lib/rsvp/store.ts`, `fakeFixtures`). One store serves every worker and
every project for the whole server run, and it outlives each project. A spec that
writes to it can change what another spec reads. Before ADR 0002 these rules
lived as comments in the specs.

## Decision

1. **Serialise writes and counted reads (L-022).** `withAdminLock`
   (`tests/helpers/admin-lock.ts`) is a cross-process lock held around admin writes
   and count reads, so no test sees another test's temporary household. For
   example, `admin.spec.ts` reads the slipper chart under it.
   `withGarciaLock` (`tests/rsvp.spec.ts`) is a directory lock keyed by checkout.
   It keeps one writer on the single Garcia answer between submit and read-back,
   and a lock older than a minute counts as stale.
2. **Each test owns its data.** Admin tests save a household under a surname of
   their own (`uniqueSurname` in `admin-guests.spec.ts`), because the store
   refuses a repeat name. They archive what they added, because other specs count
   active households, and they put back any open seat they removed
   (`admin-guests.spec.ts`, including the L-053 no-JS round trips).
   `rsvp.spec.ts` writes a unique name, so the value it reads back is provably
   its own write. A read-only spec stops the browser's own submission at the form
   (`admin-rsvps.spec.ts`), and a refused save needs no temporary household.
3. **Expected values come from the source (L-017, L-021).** Counts come from the
   fixture or the fake store, never from a rendered or async label
   (`rsvp-paths.spec.ts`, `admin.spec.ts`). Copy comes from the component or the
   content JSON (`preloader.spec.ts`), which `check:spec-copy` enforces.
4. **Fakes match the platform.** `SqliteD1` (`tests/helpers/d1-sqlite.ts`)
   applies every migration in order, so tests see the current schema. The fake
   rate limiter in `rsvp-unit.test.ts` throws when given a bare string instead of
   an options object, as the Workers `Ratelimit` binding does. `d1-budget.test.ts` counts each index entry as a
   written row, as D1 bills it.
5. **A dirty form is left alone.** Once an edit form is dirty, leaving it would
   rightly trigger `beforeunload`, so a spec takes its next step on a fresh page
   (`admin-guests.spec.ts`).

## Consequences

- A new spec that writes to the fake store takes the lock, uses its own data, and
  restores what it changed. It passes `--repeat-each 20 --workers 8` (L-022
  **Check**).
- Waiting on a lock counts against the test timeout, so a heavily locked test is
  marked slow (ADR 0003).
