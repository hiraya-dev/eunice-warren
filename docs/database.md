# Database

Production RSVP and song requests use Cloudflare D1 through Drizzle ORM. The
schema is in `src/lib/db/schema.ts`; `migrations/` contains the SQLite migration.

`households` owns invite metadata, `invite_seats` is the source of truth for
reserved seats, and append-only `responses` plus `response_seats` keep RSVP
history. `songs` stores playlist requests. Seating and reminder tables are
dashboard-ready. Ticket codes are public references; IDs and labels are host-only.

The household ticket-code unique index resolves signed RSVP tokens without
exposing the host slug. Seat `name_key` and `surname_key` indexes support exact
and bounded near-name lookup; `(household_id, slot)` keeps display order unique.
The response index puts the newest reply first for each household, while the
submitted-at index supports the latest-reply dashboard metric. `songs.name_key`
supports the per-name cap. Assignment indexes enforce one position per table and
one table seat per invite seat. Reminder indexes group a household's history.

```text
households 1──∞ invite_seats 1──∞ response_seats ∞──1 responses
    │                 │
    ├──∞ responses    └──0..1 seat_assignments ∞──1 seating_tables
    └──∞ reminders
```

Apply locally or remotely with `wrangler d1 migrations apply eunice-warren
--local|--remote`. `wrangler d1 export` keeps a portable backup. Guest imports
run through `scripts/db/import-guests.mjs`; `--replace` is intentionally guarded
by the responses foreign key once any RSVP exists.

The first migration is intentionally the complete schema. A later schema change
gets a new generated migration and is applied to a backup before production:

```sh
npx drizzle-kit generate
wrangler d1 migrations apply eunice-warren --remote
wrangler d1 export eunice-warren --remote --output=backup.sql
node scripts/db/import-guests.mjs guests.csv --write seed.sql
```
