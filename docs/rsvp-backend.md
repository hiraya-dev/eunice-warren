# RSVP backend

The RSVP UI remains a prerendered static Astro page. Its browser script calls
Astro actions running in the Cloudflare Worker. The actions validate input,
enforce the Manila deadline, verify Turnstile, rate-limit requests, sign
short-lived invite tokens, and use either the D1 store or the server-side fake
store.

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
IP limiters. Songs use an atomic total cap of 500 and a per-name cap of 20. D1
free-tier row-limit errors are converted to a short retry message instead of
leaking the platform error.

`RSVP_STORE=fake` is used for local development, Playwright, and Cloudflare
Worker previews. Production is configured with `RSVP_STORE=d1`; a missing D1
binding fails instead of falling back to fixtures. The committed preview variables
set both `RSVP_STORE=fake` and `PUBLIC_RSVP_STORE=fake` because previews share the
Worker's production secrets. Workers Builds also sets the public value at build
time for every non-`main` branch, so preview bundles skip Turnstile and use the
local test token. An explicitly configured `PUBLIC_RSVP_STORE` still wins.

The old Google Sheets implementation is dormant under
`src/lib/rsvp/legacy-sheets/` and is not selected by runtime configuration.

## Production setup

1. Create the Cloudflare D1 database named `eunice-warren` and keep the top-level
   `DB` binding in `wrangler.jsonc` pointed at it.
2. Apply committed migrations with
   `npx wrangler d1 migrations apply eunice-warren --remote`. Use `--local` for a
   local D1 database.
3. Import the hosts' guest CSV with
   `node scripts/db/import-guests.mjs <guests.csv> --write <seed.sql>`. Review the
   report before running
   `npx wrangler d1 execute eunice-warren --remote --file <seed.sql>`. Add
   `--replace` only before responses exist; the response foreign
   key deliberately blocks replacement after an RSVP has been recorded.
4. Create a Cloudflare Turnstile widget for the production hostname and note its
   public site key.
5. Add `RSVP_TOKEN_SECRET` and `TURNSTILE_SECRET_KEY` with `wrangler secret put`.
   No Workers Builds variables are needed for production. The production
   Turnstile site key (`0x4AAAAAAGLQ97oeYHLG-p4Y`, public) is the fallback in
   `src/scripts/turnstile.ts`; set `PUBLIC_TURNSTILE_SITE_KEY` at build time only
   to use a different widget.
6. Build and deploy with `npm run build` followed by `npx wrangler deploy`. With
   the Astro Cloudflare adapter, Wrangler uses the generated server entrypoint and
   asset configuration. A Workers Builds deploy command may remain
   `npx wrangler deploy`, but its build step must still run `npm run build` first.

## Local development

Copy `.dev.vars.example` to `.dev.vars`; its values are non-secret test values.
Then run `npm run dev`. The fake fixtures include Liza Santos, Ana Reyes, Mateo
Cruz, Sofia Cruz, and the intentional Error Test failure path. The fake store
skips Turnstile network verification and the Turnstile script. Playwright sets
the same fake-store values for its production-build preview.
