# Prelaunch checklist

Clean-up to finish before the site launches. Tick each item in the PR that does it.

- [ ] Delete the dormant Google Sheets RSVP code (`src/lib/rsvp/legacy-sheets/`,
      its tests and `docs/rsvp-backend.md`'s Sheet sections). D1 replaced it in the
      D1 PR; it was kept dormant on the user's call (2026-11-21). The Google Sheet
      itself and the `GOOGLE_SERVICE_ACCOUNT_JSON` / `GOOGLE_SHEET_ID` secrets are
      the user's to retire; never delete or clear anything on the Sheet.
- [ ] Set `SITE_INDEXABLE` in `src/consts.ts` to `true`, only when the user says to
      launch.
