import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { createD1RsvpStore } from "../src/lib/rsvp/d1.ts";
import { createD1SongStore } from "../src/lib/songs/store.ts";
import { getUnnamedPlusOneCount } from "../src/lib/db/summary.ts";
import type { D1Database, D1PreparedStatement } from "../src/lib/db/types.ts";

type Budget = { rowsRead: number; rowsWritten: number; roundTrips: number };

const meterDatabase = (database: D1Database) => {
  let budget: Budget = { rowsRead: 0, rowsWritten: 0, roundTrips: 0 };
  const underlying = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const record = (result: unknown) => {
    const meta = (result as { meta?: { rows_read?: number; rows_written?: number } } | undefined)?.meta;
    budget.rowsRead += Number(meta?.rows_read ?? 0);
    budget.rowsWritten += Number(meta?.rows_written ?? 0);
    return result;
  };
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped: D1PreparedStatement = {
      bind: (...values) => wrap(statement.bind(...values)),
      first: async (column) => { budget.roundTrips += 1; return statement.first(column); },
      raw: async () => { budget.roundTrips += 1; return statement.raw(); },
      all: async <T = Record<string, unknown>>() => { budget.roundTrips += 1; return record(await statement.all<T>()) as { results: T[]; success: boolean; meta?: Record<string, unknown> }; },
      run: async () => { budget.roundTrips += 1; return record(await statement.run()) as Awaited<ReturnType<D1PreparedStatement["run"]>>; },
    };
    underlying.set(wrapped, statement);
    return wrapped;
  };
  const measured: D1Database = {
    prepare: (query) => wrap(database.prepare(query)),
    batch: async (statements) => {
      const results = await database.batch(statements.map((statement) => underlying.get(statement) ?? statement) as unknown as typeof statements);
      budget.roundTrips += 1;
      for (const result of results) record(result);
      return results;
    },
  };
  return {
    database: measured,
    reset: () => { budget = { rowsRead: 0, rowsWritten: 0, roundTrips: 0 }; },
    budget: () => ({ ...budget }),
  };
};

test("D1 query budgets with Miniflare", async (t) => {
  let miniflare: Miniflare;
  let db: D1Database & { exec(query: string): Promise<unknown> };
  try {
    miniflare = new Miniflare({
      enableDevRegistry: false,
      workers: [{ config: {
        name: "d1-budget",
        compatibilityDate: "2026-08-13",
        manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: "export default {}" } } },
        env: { DB: { type: "d1" } },
      } }],
    });
    db = await miniflare.getD1Database("DB") as unknown as typeof db;
    await db.exec("SELECT 1");
  } catch (error) {
    await miniflare!?.dispose().catch(() => {});
    t.skip(`Miniflare failed to start: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  try {
    for (const file of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
      const migration = readFileSync(`migrations/${file}`, "utf8");
      for (const statement of migration.split(/--> statement-breakpoint\s*/).map((part) => part.trim()).filter(Boolean))
        await db.prepare(statement).run();
    }

    const now = "2026-11-21T00:00:00.000Z";
    const inserts: D1PreparedStatement[] = [];
    const household = db.prepare("INSERT INTO households (id,label,display_name,ticket_code,created_at,updated_at) VALUES (?,?,?,?,?,?)");
    const member = db.prepare("INSERT INTO invite_seats (household_id,kind,slot,status,invited_name,name_key,surname_key,name,created_at,updated_at) VALUES (?,'member',1,'active',?,?,?,?,?,?)");
    const plusOne = db.prepare("INSERT INTO invite_seats (household_id,kind,slot,status,created_at,updated_at) VALUES (?,'plus_one',2,'active',?,?)");
    inserts.push(household.bind("target", "Target_Test", "Target Family", "TARGET", now, now));
    inserts.push(member.bind("target", "Lucia Target", "lucia target", "target", "Lucia Target", now, now));
    inserts.push(plusOne.bind("target", now, now));
    for (let index = 0; index < 500; index += 1) {
      const id = `filler-${index}`;
      inserts.push(household.bind(id, `Filler_${index}`, `Filler ${index}`, `F${String(index).padStart(5, "0")}`, now, now));
      inserts.push(member.bind(id, `Guest ${index} Filler`, `guest ${index} filler`, "filler", `Guest ${index} Filler`, now, now));
      if (index < 99) inserts.push(plusOne.bind(id, now, now));
    }
    for (let index = 0; index < inserts.length; index += 75) await db.batch(inserts.slice(index, index + 75) as D1PreparedStatement[]);

    const meter = meterDatabase(db);
    const rsvp = createD1RsvpStore(meter.database);
    const songs = createD1SongStore(meter.database);

    meter.reset();
    const exact = await rsvp.findInvite("Lucia Target");
    assert(exact?.invite);
    assert(meter.budget().roundTrips <= 3, `exact lookup used ${meter.budget().roundTrips} D1 round trips`);
    assert(meter.budget().rowsRead <= 30, `exact lookup read ${meter.budget().rowsRead} rows`);

    meter.reset();
    const greetExact = await rsvp.findInvite("Lucia Target", { includePrevious: false });
    assert(greetExact?.invite);
    assert.equal(meter.budget().roundTrips, 1, `exact greet used ${meter.budget().roundTrips} D1 round trips`);

    meter.reset();
    const near = await rsvp.findInvite("Lucai Target");
    assert.equal(near && !near.invite ? near.suggestion : null, "Lucia Target");
    assert(meter.budget().rowsRead <= 60, `near lookup read ${meter.budget().rowsRead} rows`);

    meter.reset();
    const greetNear = await rsvp.findInvite("Lucai Target", { includePrevious: false });
    assert.equal(greetNear && !greetNear.invite ? greetNear.suggestion : null, "Lucia Target");
    assert.equal(meter.budget().roundTrips, 2, `near greet used ${meter.budget().roundTrips} D1 round trips`);

    await db.prepare("INSERT INTO households (id,label,display_name,ticket_code,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind("duplicate", "Duplicate_Test", "Duplicate Family", "DUPLICATE", now, now).run();
    await db.prepare("INSERT INTO invite_seats (household_id,kind,slot,status,invited_name,name_key,surname_key,name,created_at,updated_at) VALUES (?, 'member', 1, 'active', ?, ?, ?, ?, ?, ?)").bind("duplicate", "Lucia Target", "lucia target", "target", "Lucia Target", now, now).run();
    meter.reset();
    assert.equal(await rsvp.findInvite("Lucia Target", { includePrevious: false }), null);
    assert.equal(meter.budget().roundTrips, 2, `duplicate greet used ${meter.budget().roundTrips} D1 round trips`);

    meter.reset();
    await rsvp.submit({ inviteId: "target", name: "Lucia Target", attending: true, guests: 1, email: "luna@example.com", seats: [
      { seatId: exact.invite.seatList![0].seatId, name: "Lucia Target", shownName: "Lucia Target", attending: true, slipperSize: "W 7" },
      { seatId: exact.invite.seatList![1].seatId, name: "", shownName: "", attending: false },
    ] });
    assert(meter.budget().rowsRead <= 40, `submit read ${meter.budget().rowsRead} rows`);
    assert(meter.budget().rowsWritten <= 25, `submit wrote ${meter.budget().rowsWritten} rows`);

    meter.reset();
    await songs.add({ name: "Lucia Target", song: "A Test Song" });
    assert(meter.budget().rowsRead <= 525, `song submit read ${meter.budget().rowsRead} rows`);
    assert(meter.budget().rowsWritten <= 3, `song submit wrote ${meter.budget().rowsWritten} rows`);

    meter.reset();
    await assert.rejects(() => songs.add({ name: "Made Up Guest", song: "A Refused Song" }));
    assert(meter.budget().rowsRead <= 1250, `refused song submit read ${meter.budget().rowsRead} rows`);

    meter.reset();
    assert.equal(await getUnnamedPlusOneCount(meter.database), 99);
    assert(meter.budget().rowsRead <= 300, `unnamed plus-one count read ${meter.budget().rowsRead} rows`);
  } finally {
    await miniflare!.dispose();
  }
});
