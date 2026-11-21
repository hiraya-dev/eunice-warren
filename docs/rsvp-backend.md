# RSVP backend

Production uses the D1 store in `src/lib/rsvp/d1.ts`, with Drizzle queries over
the normalized `invite_seats` lookup indexes. Every submission appends a response
and its seat rows; it never updates or deletes response history. Guest name
changes update only the current invite seat name and retain the invited name and
lookup keys.

The token signs the six-character `ticket_code`, not the host-only household ID.
Find returns only the display name, active seat count, ticket code and seat list;
email, notes, labels and IDs stay server-side. Submissions include stable
`seatId` values and are rejected if the active invite changed. The response,
response seats and any nonblank guest name write-back are sent in one D1 batch.
Blank names never clear a stored seat name.

The RSVP and song actions verify Turnstile before applying their five-per-minute
IP limiters. Songs use an atomic total cap of 500 and a per-name cap of 20.
D1 free-tier row-limit errors are deliberately converted to a short retry message
instead of leaking the platform error.

Tests and previews set `RSVP_STORE=fake`, which uses the in-memory fixtures. The
old Google Sheets implementation is dormant under `src/lib/rsvp/legacy-sheets/`
and is not selected by runtime configuration.

The D1 binding is `DB`. Apply migrations with `wrangler d1 migrations apply
eunice-warren --local` or `--remote`.
