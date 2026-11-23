import test from "node:test";
import assert from "node:assert/strict";
import { createD1AdminStore } from "../src/lib/admin/d1.ts";
import {
  createFakeAdminStore,
  fakeAdminFixtures,
} from "../src/lib/admin/fake.ts";
import { StaleHouseholdError } from "../src/lib/admin/store.ts";
import { createD1RsvpStore, InviteChangedError } from "../src/lib/rsvp/d1.ts";
import { normalizeGuestName } from "../src/lib/rsvp/store.ts";
import { SqliteD1 } from "./helpers/d1-sqlite.ts";

const now = "2026-11-21T00:00:00.000Z";
function setup() {
  const database = new SqliteD1();
  database.applyMigration();
  database.db.exec(`
    INSERT INTO households (id,label,display_name,ticket_code,status,created_at,updated_at,updated_by)
      VALUES ('alpha','ALPHA_01','Alpha Family','ALPHA1','active','${now}','${now}',NULL);
    INSERT INTO invite_seats (id,household_id,kind,slot,status,invited_name,name_key,surname_key,name,created_at,updated_at)
      VALUES (1,'alpha','member',1,'active','Alice Alpha','alice alpha','alpha','Alice Alpha','${now}','${now}'),
             (2,'alpha','member',2,'active','Bob Alpha','bob alpha','alpha','Bob Alpha','${now}','${now}'),
             (3,'alpha','plus_one',3,'active',NULL,NULL,NULL,NULL,'${now}','${now}');
  `);
  return database;
}
const seatInput = (overrides: Record<number, Record<string, unknown>> = {}) =>
  [1, 2, 3].map((id) => ({
    id,
    name: id === 1 ? "Alice Alpha" : id === 2 ? "Bob Alpha" : "",
    invitedName: id < 3 ? (id === 1 ? "Alice Alpha" : "Bob Alpha") : undefined,
    ...overrides[id],
  }));

test("validates invitation name blank, invitation name length, member blank, and seat bounds", async () => {
  const database = setup();
  const store = createD1AdminStore(database);
  const base = {
    id: "alpha",
    updatedAt: now,
    notes: null,
    seatCount: 3,
    seats: seatInput(),
  };
  assert.equal(
    (
      await store.saveHousehold(
        { ...base, displayName: "" },
        "host@example.com",
      )
    ).ok,
    false,
  );
  assert.equal(
    (
      await store.saveHousehold(
        { ...base, displayName: "x".repeat(41) },
        "host@example.com",
      )
    ).ok,
    false,
  );
  assert.equal(
    (
      await store.saveHousehold(
        {
          ...base,
          displayName: "Alpha",
          seats: seatInput({ 1: { name: "" } }),
        },
        "host@example.com",
      )
    ).ok,
    false,
  );
  assert.equal(
    (
      await store.saveHousehold(
        { ...base, displayName: "Alpha", seatCount: 13 },
        "host@example.com",
      )
    ).ok,
    false,
  );
  assert.equal(
    (
      await store.saveHousehold(
        { ...base, displayName: "Alpha", seatCount: 1 },
        "host@example.com",
      )
    ).ok,
    false,
  );
  database.close();
});

test("D1 keeps typed renames and only follows an invited-name fix when the old name was untouched", async () => {
  const cases = [
    {
      name: "plain rename",
      inputName: "Ally Alpha",
      invitedName: "Alice Alpha",
      expectedName: "Ally Alpha",
      expectedInvited: "Alice Alpha",
    },
    {
      name: "invited-name fix with untouched name",
      inputName: "Alice Alpha",
      invitedName: "Alicia Alpha",
      expectedName: "Alicia Alpha",
      expectedInvited: "Alicia Alpha",
    },
    {
      name: "invited-name fix with a separate typed rename",
      inputName: "Ally Alpha",
      invitedName: "Alicia Alpha",
      expectedName: "Ally Alpha",
      expectedInvited: "Alicia Alpha",
    },
  ];
  for (const scenario of cases) {
    const database = setup();
    const store = createD1AdminStore(database);
    const result = await store.saveHousehold(
      {
        id: "alpha",
        updatedAt: now,
        displayName: "Alpha Family",
        notes: "Updated",
        seatCount: 3,
        seats: seatInput({
          1: {
            name: scenario.inputName,
            invitedName: scenario.invitedName,
          },
        }),
      },
      "host@example.com",
    );
    assert.equal(result.ok, true, scenario.name);
    const row = database.db
      .prepare(
        "SELECT name,invited_name,name_key,surname_key,named_by_kind,named_by FROM invite_seats WHERE id=1",
      )
      .get() as Record<string, unknown>;
    assert.deepEqual(
      { ...row },
      {
        name: scenario.expectedName,
        invited_name: scenario.expectedInvited,
        name_key: normalizeGuestName(scenario.expectedInvited),
        surname_key: "alpha",
        named_by_kind: "host",
        named_by: "host@example.com",
      },
      scenario.name,
    );
    database.close();
  }
});

test("D1 display-name-only save preserves every seat attribution and timestamp", async () => {
  const database = setup();
  database.db.exec(`
    UPDATE invite_seats
    SET name='Guest Named Plus One', named_by_kind='guest', named_by='Alice Alpha',
        named_at='2026-11-20T08:00:00.000Z', updated_at='2026-11-20T08:00:00.000Z'
    WHERE id=3;
  `);
  const before = database.db
    .prepare(
      "SELECT id,named_by_kind,named_by,named_at,updated_at FROM invite_seats ORDER BY id",
    )
    .all()
    .map((row) => ({ ...row }));
  const result = await createD1AdminStore(database).saveHousehold(
    {
      id: "alpha",
      updatedAt: now,
      displayName: "A clearer invitation name",
      notes: null,
      seatCount: 3,
      seats: seatInput({ 3: { name: "Guest Named Plus One" } }),
    },
    "host@example.com",
  );
  assert.equal(result.ok, true);
  const after = database.db
    .prepare(
      "SELECT id,named_by_kind,named_by,named_at,updated_at FROM invite_seats ORDER BY id",
    )
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(after, before);
  database.close();
});

test("D1 add validates label length and creates a collision-safe household", async () => {
  const database = setup();
  const store = createD1AdminStore(database);
  await assert.rejects(() =>
    store.addHousehold(
      {
        label: "",
        displayName: "Family",
        notes: null,
        seats: [{ name: "Member" }],
      },
      "host@example.com",
    ),
  );
  await assert.rejects(() =>
    store.addHousehold(
      {
        label: "x".repeat(81),
        displayName: "Family",
        notes: null,
        seats: [{ name: "Member" }],
      },
      "host@example.com",
    ),
  );
  const added = await store.addHousehold(
    {
      label: "Alpha",
      displayName: "Another Alpha",
      notes: null,
      seats: [{ name: "Member One" }],
      seatCount: 2,
    },
    "host@example.com",
  );
  assert.equal(added.id, "alpha-2");
  const household = database.db
    .prepare("SELECT ticket_code FROM households WHERE id=?")
    .get(added.id) as { ticket_code: string };
  assert.match(household.ticket_code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
  assert.deepEqual(
    database.db
      .prepare(
        "SELECT kind,invited_name,name_key,surname_key,name FROM invite_seats WHERE household_id=? ORDER BY slot",
      )
      .all(added.id)
      .map((row) => ({ ...row })),
    [
      {
        kind: "member",
        invited_name: "Member One",
        name_key: "member one",
        surname_key: "one",
        name: "Member One",
      },
      {
        kind: "plus_one",
        invited_name: null,
        name_key: null,
        surname_key: null,
        name: null,
      },
    ],
  );
  database.close();
});

test("D1 add refuses an active host ID collision", async () => {
  const database = setup();
  await assert.rejects(
    () =>
      createD1AdminStore(database).addHousehold(
        {
          label: "ALPHA_01",
          displayName: "Another Alpha",
          notes: null,
          seats: [{ name: "A new guest" }],
        },
        "host@example.com",
      ),
    /Host ID is already in use/,
  );
  database.close();
});

test("D1 refuses an already invited full name and accepts it after confirmation", async () => {
  const database = setup();
  database.db.exec(`
    INSERT INTO households (id,label,display_name,ticket_code,status,created_at,updated_at)
      VALUES ('beta','BETA_01','Beta Family','BETA1','active','${now}','${now}');
    INSERT INTO invite_seats (id,household_id,kind,slot,status,invited_name,name_key,surname_key,name,created_at,updated_at)
      VALUES (4,'beta','member',1,'active','Casey Beta','casey beta','beta','Casey Beta','${now}','${now}');
  `);
  const store = createD1AdminStore(database);
  await assert.rejects(
    () =>
      store.addHousehold(
        {
          label: "Gamma",
          displayName: "Gamma",
          notes: null,
          seats: [{ name: "Casey Beta" }],
        },
        "host@example.com",
      ),
    /already invited/,
  );
  const added = await store.addHousehold(
    {
      label: "Gamma",
      displayName: "Gamma",
      notes: null,
      seats: [{ name: "Casey Beta" }],
      confirmedNames: ["Casey Beta"],
    },
    "host@example.com",
  );
  assert.equal(added.id, "gamma");
  database.close();
});

test("D1 does not warn on a surname-only match", async () => {
  const database = setup();
  const result = await createD1AdminStore(database).addHousehold(
    {
      label: "Beta Only",
      displayName: "Beta Only",
      notes: null,
      seats: [{ name: "Beta" }],
    },
    "host@example.com",
  );
  assert.equal(result.id, "beta-only");
  database.close();
});

test("D1 refuses a name typed twice in one draft", async () => {
  const database = setup();
  await assert.rejects(
    () =>
      createD1AdminStore(database).addHousehold(
        {
          label: "Twin",
          displayName: "Twin",
          notes: null,
          seats: [{ name: "Casey Beta" }, { name: "casey  beta" }],
        },
        "host@example.com",
      ),
    /only be added once/,
  );
  database.close();
});

test("D1 refuses a duplicate host ID on save", async () => {
  const database = setup();
  database.db.exec(
    `INSERT INTO households (id,label,display_name,ticket_code,status,created_at,updated_at) VALUES ('beta','BETA_01','Beta','BETA1','active','${now}','${now}');`,
  );
  const result = await createD1AdminStore(database).saveHousehold(
    {
      id: "alpha",
      label: "BETA_01",
      updatedAt: now,
      displayName: "Alpha",
      notes: null,
      seatCount: 3,
      seats: seatInput(),
    },
    "host@example.com",
  );
  assert.deepEqual(result, {
    ok: false,
    message: "Host ID is already in use.",
  });
  database.close();
});

test("save refuses duplicate names inside the draft in both stores", async () => {
  const database = setup();
  const d1 = await createD1AdminStore(database).saveHousehold(
    {
      id: "alpha",
      updatedAt: now,
      displayName: "Alpha",
      notes: null,
      seatCount: 3,
      seats: seatInput({ 2: { name: "Alice Alpha", invitedName: "Alice Alpha" } }),
    },
    "host@example.com",
  );
  assert.deepEqual(d1, {
    ok: false,
    message: "The name “alice alpha” is already in this draft.",
  });
  database.close();

  const row = fakeAdminFixtures.find((fixture) => fixture.id === "hh-admin-editor")!;
  const original = structuredClone(row);
  try {
    const fake = await createFakeAdminStore().saveHousehold(
      {
        id: row.id,
        updatedAt: row.updatedAt,
        displayName: row.displayName,
        notes: row.notes,
        seatCount: row.seatCount,
        seats: row.seats.map((seat, index) => ({
          id: seat.id ?? seat.slot,
          name: index === 1 ? row.seats[0].name ?? "" : seat.name ?? "",
          invitedName: index === 1 ? row.seats[0].invitedName ?? undefined : seat.invitedName ?? undefined,
        })),
      },
      "host@example.com",
    );
    assert.deepEqual(fake, {
      ok: false,
      message: "A guest name can only be added once.",
    });
  } finally {
    Object.assign(row, original);
    row.seats = original.seats;
  }
});

test("edit refuses an already invited name until it is confirmed in both stores", async () => {
  const database = setup();
  database.db.exec(`
    INSERT INTO households (id,label,display_name,ticket_code,status,created_at,updated_at)
      VALUES ('beta','BETA_01','Beta Family','BETA1','active','${now}','${now}');
    INSERT INTO invite_seats (id,household_id,kind,slot,status,invited_name,name_key,surname_key,name,created_at,updated_at)
      VALUES (4,'beta','member',1,'active','Casey Beta','casey beta','beta','Casey Beta','${now}','${now}');
  `);
  const d1Store = createD1AdminStore(database);
  const input = {
    id: "alpha",
    updatedAt: now,
    displayName: "Alpha",
    notes: null,
    seatCount: 3,
    seats: seatInput({ 2: { name: "Casey Beta", invitedName: "Casey Beta" } }),
  };
  assert.deepEqual(await d1Store.saveHousehold(input, "host@example.com"), {
    ok: false,
    message: "casey beta is already invited with Beta Family.",
  });
  assert.equal(
    (await d1Store.saveHousehold({ ...input, confirmedNames: ["Casey Beta"] }, "host@example.com")).ok,
    true,
  );
  database.close();

  const row = fakeAdminFixtures.find((fixture) => fixture.id === "hh-admin-editor")!;
  const source = fakeAdminFixtures.find((fixture) => fixture.id === "hh-santos")!;
  const original = structuredClone(row);
  try {
    const fakeStore = createFakeAdminStore();
    const fakeInput = {
      id: row.id,
      updatedAt: row.updatedAt,
      displayName: row.displayName,
      notes: row.notes,
      seatCount: row.seatCount,
      seats: row.seats.map((seat, index) => ({
        id: seat.id ?? seat.slot,
        name: index === 1 ? source.seats[0].name ?? "" : seat.name ?? "",
        invitedName: index === 1 ? source.seats[0].invitedName ?? undefined : seat.invitedName ?? undefined,
      })),
    };
    const refused = await fakeStore.saveHousehold(fakeInput, "host@example.com");
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.match(refused.message, /already invited/);
    assert.equal(
      (
        await fakeStore.saveHousehold(
          { ...fakeInput, confirmedNames: [source.seats[0].name!] },
          "host@example.com",
        )
      ).ok,
      true,
    );
  } finally {
    Object.assign(row, original);
    row.seats = original.seats;
  }
});

test("save rejects blank and overlong host labels in both stores", async () => {
  const database = setup();
  const d1Store = createD1AdminStore(database);
  for (const label of ["", "x".repeat(81)])
    assert.deepEqual(
      await d1Store.saveHousehold(
        { id: "alpha", updatedAt: now, label, displayName: "Alpha", notes: null, seatCount: 3, seats: seatInput() },
        "host@example.com",
      ),
      { ok: false, message: "Host label is required and must be 80 characters or fewer." },
    );
  database.close();

  const row = fakeAdminFixtures.find((fixture) => fixture.id === "hh-admin-editor")!;
  for (const label of ["", "x".repeat(81)])
    assert.deepEqual(
      await createFakeAdminStore().saveHousehold(
        { id: row.id, updatedAt: row.updatedAt, label, displayName: row.displayName, notes: row.notes, seatCount: row.seatCount, seats: row.seats.map((seat) => ({ id: seat.id ?? seat.slot, name: seat.name ?? "", invitedName: seat.invitedName ?? undefined })) },
        "host@example.com",
      ),
      { ok: false, message: "Host label is required and must be 80 characters or fewer." },
    );
});

for (const scenario of [
  {
    name: "blank invitation name",
    input: {
      label: "NEW_01",
      displayName: "",
      notes: null,
      seats: [{ name: "Member" }],
    },
  },
  {
    name: "no members",
    input: {
      label: "NEW_01",
      displayName: "New household",
      notes: null,
      seats: [],
    },
  },
  {
    name: "blank member",
    input: {
      label: "NEW_01",
      displayName: "New household",
      notes: null,
      seats: [{ name: "Member" }, { name: "" }],
    },
  },
  {
    name: "fewer seats than members",
    input: {
      label: "NEW_01",
      displayName: "New household",
      notes: null,
      seats: [{ name: "One" }, { name: "Two" }],
      seatCount: 1,
    },
  },
  {
    name: "more than twelve seats",
    input: {
      label: "NEW_01",
      displayName: "New household",
      notes: null,
      seats: [{ name: "Member" }],
      seatCount: 13,
    },
  },
])
  test(`D1 add refuses ${scenario.name}`, async () => {
    const database = setup();
    await assert.rejects(
      () =>
        createD1AdminStore(database).addHousehold(
          scenario.input,
          "host@example.com",
        ),
      Error,
    );
    database.close();
  });

test("D1 save refuses a missing household", async () => {
  const database = setup();
  const result = await createD1AdminStore(database).saveHousehold(
    {
      id: "missing",
      updatedAt: now,
      displayName: "Missing",
      notes: null,
      seatCount: 1,
      seats: [{ name: "Member" }],
    },
    "host@example.com",
  );
  assert.deepEqual(result, { ok: false, message: "Household not found." });
  database.close();
});

test("D1 save refuses a seat from another household", async () => {
  const database = setup();
  const result = await createD1AdminStore(database).saveHousehold(
    {
      id: "alpha",
      updatedAt: now,
      displayName: "Alpha",
      notes: null,
      seatCount: 3,
      seats: seatInput({ 3: { id: 999 } }),
    },
    "host@example.com",
  );
  assert.deepEqual(result, {
    ok: false,
    message: "Household changed. Reload to see the latest.",
  });
  database.close();
});

test("D1 stale save rolls back every statement", async () => {
  const database = setup();
  const store = createD1AdminStore(database);
  await store.saveHousehold(
    {
      id: "alpha",
      updatedAt: now,
      displayName: "First save",
      notes: null,
      seatCount: 3,
      seats: seatInput(),
    },
    "host@example.com",
  );
  await assert.rejects(
    () =>
      store.saveHousehold(
        {
          id: "alpha",
          updatedAt: now,
          displayName: "Stale save",
          notes: "must not persist",
          seatCount: 4,
          seats: seatInput(),
        },
        "other@example.com",
      ),
    StaleHouseholdError,
  );
  const row = database.db
    .prepare(
      "SELECT display_name,notes,updated_by FROM households WHERE id='alpha'",
    )
    .get() as Record<string, unknown>;
  assert.deepEqual(
    { ...row },
    { display_name: "First save", notes: null, updated_by: "host@example.com" },
  );
  database.close();
});

test("D1 stale archive rolls back without changing the household", async () => {
  const database = setup();
  await assert.rejects(
    () =>
      createD1AdminStore(database).archiveHousehold(
        "alpha",
        "host@example.com",
        "stale-token",
      ),
    StaleHouseholdError,
  );
  assert.deepEqual(
    {
      ...(database.db
        .prepare(
          "SELECT status,archived_at,archived_by,updated_at,updated_by FROM households WHERE id='alpha'",
        )
        .get() as Record<string, unknown>),
    },
    {
      status: "active",
      archived_at: null,
      archived_by: null,
      updated_at: now,
      updated_by: null,
    },
  );
  database.close();
});

test("D1 refuses removal with a name, a response, or an assignment", async () => {
  const removable = setup();
  assert.equal(
    (
      await createD1AdminStore(removable).saveHousehold(
        {
          id: "alpha",
          updatedAt: now,
          displayName: "Alpha",
          notes: null,
          seatCount: 2,
          seats: seatInput({ 3: { name: "" } }),
        },
        "host@example.com",
      )
    ).ok,
    true,
  );
  removable.close();
  const named = setup();
  const store = createD1AdminStore(named);
  named.db.exec("UPDATE invite_seats SET name='Named Guest' WHERE id=3;");
  assert.equal(
    (
      await store.saveHousehold(
        {
          id: "alpha",
          updatedAt: now,
          displayName: "Alpha",
          notes: null,
          seatCount: 2,
          seats: seatInput(),
        },
        "host@example.com",
      )
    ).ok,
    false,
  );
  named.db.exec(
    "UPDATE invite_seats SET name=NULL WHERE id=3; INSERT INTO responses (id,household_id,submitted_at,respondent_name,attending,guest_count,email) VALUES (1,'alpha','2026-11-21T01:00:00Z','Alice',1,1,'a@example.com'); INSERT INTO response_seats (response_id,seat_id,kind,name,attending) VALUES (1,3,'plus_one','Guest',1);",
  );
  assert.equal(
    (
      await store.saveHousehold(
        {
          id: "alpha",
          updatedAt: now,
          displayName: "Alpha",
          notes: null,
          seatCount: 2,
          seats: seatInput({ 3: { name: "" } }),
        },
        "host@example.com",
      )
    ).ok,
    false,
  );
  named.close();
  const assigned = setup();
  assigned.db.exec(
    `INSERT INTO seating_tables (id,name,kind,capacity,sort_order,created_at,updated_at) VALUES (1,'One','round',12,1,'${now}','${now}'); INSERT INTO seat_assignments (table_id,seat_id,position,created_at,updated_at) VALUES (1,3,1,'${now}','${now}');`,
  );
  assert.equal(
    (
      await createD1AdminStore(assigned).saveHousehold(
        {
          id: "alpha",
          updatedAt: now,
          displayName: "Alpha",
          notes: null,
          seatCount: 2,
          seats: seatInput({ 3: { name: "" } }),
        },
        "host@example.com",
      )
    ).ok,
    false,
  );
  assigned.close();
});

test("D1 refuses retiring an assigned member and retiring the last member", async () => {
  const database = setup();
  database.db.exec(
    `INSERT INTO seating_tables (id,name,kind,capacity,sort_order,created_at,updated_at) VALUES (1,'One','round',12,1,'${now}','${now}'); INSERT INTO seat_assignments (table_id,seat_id,position,created_at,updated_at) VALUES (1,1,1,'${now}','${now}');`,
  );
  const store = createD1AdminStore(database);
  assert.equal(
    (
      await store.saveHousehold(
        {
          id: "alpha",
          updatedAt: now,
          displayName: "Alpha",
          notes: null,
          seatCount: 3,
          seats: seatInput({ 1: { retire: true } }),
        },
        "host@example.com",
      )
    ).ok,
    false,
  );
  database.db.exec("DELETE FROM seat_assignments;");
  assert.equal(
    (
      await store.saveHousehold(
        {
          id: "alpha",
          updatedAt: now,
          displayName: "Alpha",
          notes: null,
          seatCount: 2,
          seats: seatInput({ 1: { retire: true } }),
        },
        "host@example.com",
      )
    ).ok,
    true,
  );
  const oneMember = setup();
  oneMember.db.exec("DELETE FROM invite_seats WHERE id IN (2,3);");
  assert.equal(
    (
      await createD1AdminStore(oneMember).saveHousehold(
        {
          id: "alpha",
          updatedAt: now,
          displayName: "Alpha",
          notes: null,
          seatCount: 1,
          seats: [
            {
              id: 1,
              name: "Alice Alpha",
              invitedName: "Alice Alpha",
              retire: true,
            },
          ],
        },
        "host@example.com",
      )
    ).ok,
    false,
  );
  oneMember.close();
  database.close();
});

test("guest reply rejects an old form after a host adds a seat or retires one", async () => {
  const database = setup();
  const guest = createD1RsvpStore(database);
  const invite = await guest.findInvite("Alice Alpha");
  assert(invite?.invite);
  await createD1AdminStore(database).saveHousehold(
    {
      id: "alpha",
      updatedAt: now,
      displayName: "Alpha",
      notes: null,
      seatCount: 4,
      seats: seatInput(),
    },
    "host@example.com",
  );
  await assert.rejects(
    () =>
      guest.submit({
        inviteId: "alpha",
        name: "Alice Alpha",
        attending: true,
        guests: 2,
        email: "alice@example.com",
        seats: invite.invite.seatList!.map((seat) => ({
          seatId: seat.seatId,
          name: seat.name ?? "",
          attending: true,
        })),
      }),
    InviteChangedError,
  );
  database.close();
  const retiredDatabase = setup();
  const retiredGuest = createD1RsvpStore(retiredDatabase);
  const retiredInvite = await retiredGuest.findInvite("Alice Alpha");
  assert(retiredInvite?.invite);
  await createD1AdminStore(retiredDatabase).saveHousehold(
    {
      id: "alpha",
      updatedAt: now,
      displayName: "Alpha",
      notes: null,
      seatCount: 2,
      seats: seatInput({ 3: { retire: true } }),
    },
    "host@example.com",
  );
  await assert.rejects(
    () =>
      retiredGuest.submit({
        inviteId: "alpha",
        name: "Alice Alpha",
        attending: true,
        guests: 2,
        email: "alice@example.com",
        seats: retiredInvite.invite.seatList!.map((seat) => ({
          seatId: seat.seatId,
          name: seat.name ?? "",
          attending: true,
        })),
      }),
    InviteChangedError,
  );
  retiredDatabase.close();
});

test("guest lookup and an open form both reject an archived household", async () => {
  const database = setup();
  const guest = createD1RsvpStore(database);
  const lookup = await guest.findInvite("Alice Alpha");
  assert(lookup?.invite);
  await createD1AdminStore(database).archiveHousehold(
    "alpha",
    "host@example.com",
    now,
  );
  assert.equal(await guest.findInvite("Alice Alpha"), null);
  await assert.rejects(
    () =>
      guest.submit({
        inviteId: "alpha",
        name: "Alice Alpha",
        attending: true,
        guests: 2,
        email: "alice@example.com",
        seats: lookup.invite.seatList!.map((seat) => ({
          seatId: seat.seatId,
          name: seat.name ?? "",
          attending: true,
        })),
      }),
    InviteChangedError,
  );
  assert.equal(
    (
      database.db
        .prepare(
          "SELECT count(*) AS count FROM responses WHERE household_id='alpha'",
        )
        .get() as { count: number }
    ).count,
    0,
  );
  database.close();
});

test("fake stale save is refused without changing typed values", async () => {
  const row = fakeAdminFixtures.find((fixture) => fixture.id === "hh-admin-editor")!;
  const original = structuredClone(row);
  try {
    const store = createFakeAdminStore();
    const list = await store.getGuestList();
    const current = list.rows.find((item) => item.id === row.id)!;
    const token = current.updatedAt;
    await store.saveHousehold(
      {
        id: row.id,
        updatedAt: token,
        displayName: "First fake save",
        notes: null,
        seatCount: row.seatCount,
        seats: row.seats.map((seat) => ({
          id: seat.id ?? seat.slot,
          name: seat.name ?? "",
          invitedName: seat.invitedName ?? undefined,
        })),
      },
      "host@example.com",
    );
    await assert.rejects(
      () =>
        store.saveHousehold(
          {
            id: row.id,
            updatedAt: token,
            displayName: "Stale fake save",
            notes: "no",
            seatCount: row.seatCount,
            seats: row.seats.map((seat) => ({
              id: seat.id ?? seat.slot,
              name: seat.name ?? "",
              invitedName: seat.invitedName ?? undefined,
            })),
          },
          "other@example.com",
        ),
      StaleHouseholdError,
    );
    assert.equal(row.displayName, "First fake save");
  } finally {
    Object.assign(row, original);
    row.seats = original.seats;
  }
});

test("removeSeatIds refuses named and active seats and removes a safe seat in both stores", async () => {
  const database = setup();
  const d1Store = createD1AdminStore(database);
  const named = await d1Store.saveHousehold(
    { id: "alpha", updatedAt: now, displayName: "Alpha", notes: null, seatCount: 2, seats: seatInput(), removeSeatIds: [1] },
    "host@example.com",
  );
  assert.deepEqual(named, {
    ok: false,
    message: "Only an unnamed open seat with no activity can be removed.",
  });
  const safeDatabase = setup();
  const safe = await createD1AdminStore(safeDatabase).saveHousehold(
    { id: "alpha", updatedAt: now, displayName: "Alpha", notes: null, seatCount: 2, seats: seatInput(), removeSeatIds: [3] },
    "host@example.com",
  );
  assert.equal(safe.ok, true);
  assert.equal(
    (safeDatabase.db.prepare("SELECT count(*) AS count FROM invite_seats WHERE id=3").get() as { count: number }).count,
    0,
  );
  safeDatabase.close();
  database.db.exec("INSERT INTO responses (id,household_id,submitted_at,respondent_name,attending,guest_count,email) VALUES (1,'alpha','2026-11-21T01:00:00Z','Alice',1,1,'a@example.com'); INSERT INTO response_seats (response_id,seat_id,kind,name,attending) VALUES (1,3,'plus_one','Guest',1);");
  const active = await d1Store.saveHousehold(
    { id: "alpha", updatedAt: now, displayName: "Alpha", notes: null, seatCount: 2, seats: seatInput(), removeSeatIds: [3] },
    "host@example.com",
  );
  assert.deepEqual(active, {
    ok: false,
    message: "Only an unnamed open seat with no activity can be removed.",
  });
  database.close();

  const namedRow = fakeAdminFixtures.find((row) => row.id === "hh-lim")!;
  const namedOriginal = structuredClone(namedRow);
  const openRow = fakeAdminFixtures.find((row) => row.id === "hh-mendoza")!;
  const openOriginal = structuredClone(openRow);
  const activityRow = fakeAdminFixtures.find((row) => row.id === "hh-admin-activity")!;
  const activityOriginal = structuredClone(activityRow);
  try {
    const fake = createFakeAdminStore();
    const namedResult = await fake.saveHousehold(
      { id: namedRow.id, updatedAt: namedRow.updatedAt, displayName: namedRow.displayName, notes: namedRow.notes, seatCount: 1, seats: namedRow.seats.map((seat) => ({ id: seat.id ?? seat.slot, name: seat.name ?? "", invitedName: seat.invitedName ?? undefined })), removeSeatIds: [2] },
      "host@example.com",
    );
    assert.deepEqual(namedResult, {
      ok: false,
      message: "Only an unnamed open seat with no activity can be removed.",
    });
    const activityResult = await fake.saveHousehold(
      { id: activityRow.id, updatedAt: activityRow.updatedAt, displayName: activityRow.displayName, notes: activityRow.notes, seatCount: 1, seats: activityRow.seats.map((seat) => ({ id: seat.id ?? seat.slot, name: seat.name ?? "", invitedName: seat.invitedName ?? undefined })), removeSeatIds: [2] },
      "host@example.com",
    );
    assert.deepEqual(activityResult, {
      ok: false,
      message: "Only an unnamed open seat with no activity can be removed.",
    });
    const removed = await fake.saveHousehold(
      { id: openRow.id, updatedAt: openRow.updatedAt, displayName: openRow.displayName, notes: openRow.notes, seatCount: 1, seats: openRow.seats.map((seat) => ({ id: seat.id ?? seat.slot, name: seat.name ?? "", invitedName: seat.invitedName ?? undefined })), removeSeatIds: [2] },
      "host@example.com",
    );
    assert.equal(removed.ok, true);
    assert.equal(openRow.seats.some((seat) => seat.id === 2), false);
  } finally {
    Object.assign(namedRow, namedOriginal);
    namedRow.seats = namedOriginal.seats;
    Object.assign(openRow, openOriginal);
    openRow.seats = openOriginal.seats;
    Object.assign(activityRow, activityOriginal);
    activityRow.seats = activityOriginal.seats;
  }
});

test("dashboard stores use the last surname token and tolerate missing fake timestamps", async () => {
  const database = setup();
  const added = await createD1AdminStore(database).addHousehold(
    { label: "Compound", displayName: "Compound", notes: null, seats: [{ name: "Ana De Castro" }] },
    "host@example.com",
  );
  assert.equal(
    (database.db.prepare("SELECT surname_key FROM invite_seats WHERE household_id=?").get(added.id) as { surname_key: string }).surname_key,
    "castro",
  );
  database.close();

  const addedFake = await createFakeAdminStore().addHousehold(
    { label: "Compound Fake", displayName: "Compound Fake", notes: null, seats: [{ name: "Ana De Castro" }] },
    "host@example.com",
  );
  const fakeRow = fakeAdminFixtures.find((row) => row.id === addedFake.id)!;
  assert.equal(fakeRow.seats[0].surnameKey, "castro");
  const index = fakeAdminFixtures.indexOf(fakeRow);
  if (index >= 0) fakeAdminFixtures.splice(index, 1);

  const noTimestamp = fakeAdminFixtures.find((row) => row.id === "hh-mendoza")!;
  const originalNoTimestamp = structuredClone(noTimestamp);
  try {
    const result = await createFakeAdminStore().saveHousehold({
      id: noTimestamp.id,
      displayName: noTimestamp.displayName,
      notes: noTimestamp.notes,
      seatCount: noTimestamp.seatCount,
      seats: noTimestamp.seats.map((seat) => ({ id: seat.id ?? seat.slot, name: seat.name ?? "", invitedName: seat.invitedName ?? undefined })),
    }, "host@example.com");
    assert.equal(result.ok, true);
  } finally {
    Object.assign(noTimestamp, originalNoTimestamp);
    noTimestamp.seats = originalNoTimestamp.seats;
  }
});

test("fake save treats an archived household as missing", async () => {
  const row = fakeAdminFixtures.find((fixture) => fixture.id === "hh-admin-editor")!;
  const original = structuredClone(row);
  try {
    const store = createFakeAdminStore();
    await store.archiveHousehold(row.id, "host@example.com", row.updatedAt);
    const result = await store.saveHousehold({
      id: row.id,
      updatedAt: row.updatedAt,
      displayName: row.displayName,
      notes: row.notes,
      seatCount: row.seatCount,
      seats: row.seats.map((seat) => ({ id: seat.id ?? seat.slot, name: seat.name ?? "", invitedName: seat.invitedName ?? undefined })),
    }, "host@example.com");
    assert.deepEqual(result, { ok: false, message: "Household not found." });
  } finally {
    Object.assign(row, original);
    row.seats = original.seats;
    delete (row as typeof row & { archived?: boolean }).archived;
    delete row.archivedAt;
    delete row.archivedBy;
  }
});

test("fake refuses a blank member name", async () => {
  const row = fakeAdminFixtures.find(
    (fixture) => fixture.id === "hh-admin-editor",
  )!;
  const original = structuredClone(row);
  try {
    const result = await createFakeAdminStore().saveHousehold(
      {
        id: row.id,
        updatedAt: row.updatedAt,
        displayName: row.displayName,
        notes: row.notes,
        seatCount: row.seatCount,
        seats: row.seats.map((seat, index) => ({
          id: seat.id ?? seat.slot,
          name: index === 0 ? "" : (seat.name ?? ""),
          invitedName: seat.invitedName ?? undefined,
        })),
      },
      "host@example.com",
    );
    assert.deepEqual(result, {
      ok: false,
      message: "Member seat names cannot be blank.",
    });
  } finally {
    Object.assign(row, original);
    row.seats = original.seats;
  }
});

test("fake refuses seat counts outside one through twelve", async () => {
  const row = fakeAdminFixtures.find(
    (fixture) => fixture.id === "hh-admin-editor",
  )!;
  const input = {
    id: row.id,
    updatedAt: row.updatedAt,
    displayName: row.displayName,
    notes: row.notes,
    seats: row.seats.map((seat) => ({
      id: seat.id ?? seat.slot,
      name: seat.name ?? "",
      invitedName: seat.invitedName ?? undefined,
    })),
  };
  for (const seatCount of [0, 13])
    assert.deepEqual(
      await createFakeAdminStore().saveHousehold(
        { ...input, seatCount },
        "host@example.com",
      ),
      { ok: false, message: "Seats must be between 1 and 12." },
    );
});

test("fake refuses removing a trailing seat with response activity", async () => {
  const row = fakeAdminFixtures.find(
    (fixture) => fixture.id === "hh-admin-activity",
  )!;
  const result = await createFakeAdminStore().saveHousehold(
    {
      id: row.id,
      updatedAt: row.updatedAt,
      displayName: row.displayName,
      notes: row.notes,
      seatCount: 1,
      seats: row.seats.map((seat) => ({
        id: seat.id ?? seat.slot,
        name: seat.name ?? "",
        invitedName: seat.invitedName ?? undefined,
      })),
    },
    "host@example.com",
  );
  assert.deepEqual(result, {
    ok: false,
    message: "Seat 2 has activity. Review or retire this seat first.",
  });
});

test("fake assigned-seat retirement validates before mutating", async () => {
  const row = fakeAdminFixtures.find(
    (fixture) => fixture.id === "hh-admin-editor",
  )!;
  const original = structuredClone(row);
  try {
    row.assignedSeatIds = [2];
    const before = {
      displayName: row.displayName,
      notes: row.notes,
      updatedAt: row.updatedAt,
      seats: structuredClone(row.seats),
    };
    const result = await createFakeAdminStore().saveHousehold(
      {
        id: row.id,
        updatedAt: row.updatedAt,
        displayName: "Must not persist",
        notes: "Must not persist",
        seatCount: 1,
        seats: row.seats.map((seat) => ({
          id: seat.id ?? seat.slot,
          name: seat.name ?? "",
          invitedName: seat.invitedName ?? undefined,
          retire: seat.id === 2,
        })),
      },
      "host@example.com",
    );
    assert.deepEqual(result, {
      ok: false,
      message: "Seat is assigned to a table. Review the seating plan first.",
    });
    assert.deepEqual(
      {
        displayName: row.displayName,
        notes: row.notes,
        updatedAt: row.updatedAt,
        seats: row.seats,
      },
      before,
    );
  } finally {
    Object.assign(row, original);
    row.seats = original.seats;
    row.assignedSeatIds = original.assignedSeatIds;
  }
});

test("fake can save unchanged after a seat was retired", async () => {
  const row = fakeAdminFixtures.find(
    (fixture) => fixture.id === "hh-admin-editor",
  )!;
  const original = structuredClone(row);
  try {
    row.assignedSeatIds = undefined;
    const store = createFakeAdminStore();
    const retired = await store.saveHousehold(
      {
        id: row.id,
        updatedAt: row.updatedAt,
        displayName: row.displayName,
        notes: row.notes,
        seatCount: 1,
        seats: row.seats.map((seat) => ({
          id: seat.id ?? seat.slot,
          name: seat.name ?? "",
          invitedName: seat.invitedName ?? undefined,
          retire: seat.id === 2,
        })),
      },
      "host@example.com",
    );
    assert.equal(retired.ok, true);
    const reopened = (await store.getGuestList()).rows.find(
      (fixture) => fixture.id === row.id,
    )!;
    const unchanged = await store.saveHousehold(
      {
        id: reopened.id,
        updatedAt: reopened.updatedAt,
        displayName: reopened.displayName,
        notes: reopened.notes,
        seatCount: reopened.seatCount,
        seats: reopened.seats.map((seat) => ({
          id: seat.id ?? seat.slot,
          name: seat.name ?? "",
          invitedName: seat.invitedName ?? undefined,
        })),
      },
      "host@example.com",
    );
    assert.equal(unchanged.ok, true);
  } finally {
    Object.assign(row, original);
    row.seats = original.seats;
  }
});

test("fake keeps typed renames and only follows an invited-name fix when the old name was untouched", async () => {
  const row = fakeAdminFixtures.find(
    (fixture) => fixture.id === "hh-admin-editor",
  )!;
  const original = structuredClone(row);
  const cases = [
    {
      name: "plain rename",
      inputName: "Editor Parent Renamed",
      invitedName: "Editor Parent",
      expectedName: "Editor Parent Renamed",
      expectedInvited: "Editor Parent",
    },
    {
      name: "invited-name fix with untouched name",
      inputName: "Editor Parent",
      invitedName: "Edited Parent",
      expectedName: "Edited Parent",
      expectedInvited: "Edited Parent",
    },
    {
      name: "invited-name fix with a separate typed rename",
      inputName: "Parent Nickname",
      invitedName: "Edited Parent",
      expectedName: "Parent Nickname",
      expectedInvited: "Edited Parent",
    },
  ];
  try {
    for (const scenario of cases) {
      Object.assign(row, structuredClone(original));
      row.seats = structuredClone(original.seats);
      const result = await createFakeAdminStore().saveHousehold(
        {
          id: row.id,
          updatedAt: row.updatedAt,
          displayName: row.displayName,
          notes: row.notes,
          seatCount: row.seatCount,
          seats: row.seats.map((seat, index) => ({
            id: seat.id ?? seat.slot,
            name: index === 0 ? scenario.inputName : (seat.name ?? ""),
            invitedName:
              index === 0
                ? scenario.invitedName
                : (seat.invitedName ?? undefined),
          })),
        },
        "host@example.com",
      );
      assert.equal(result.ok, true, scenario.name);
      assert.equal(row.seats[0].name, scenario.expectedName, scenario.name);
      assert.equal(
        row.seats[0].invitedName,
        scenario.expectedInvited,
        scenario.name,
      );
      assert.equal(row.seats[0].namedByKind, "host", scenario.name);
      assert.equal(row.seats[0].namedBy, "host@example.com", scenario.name);
    }
  } finally {
    Object.assign(row, original);
    row.seats = original.seats;
  }
});

test("fake display-name-only save preserves every seat attribution and timestamp", async () => {
  const row = fakeAdminFixtures.find((fixture) => fixture.id === "hh-lim")!;
  const original = structuredClone(row);
  const seatState = () =>
    row.seats.map(({ namedByKind, namedBy, namedAt, updatedAt }) => ({
      namedByKind,
      namedBy,
      namedAt,
      updatedAt,
    }));
  try {
    const before = structuredClone(seatState());
    const result = await createFakeAdminStore().saveHousehold(
      {
        id: row.id,
        updatedAt: row.updatedAt,
        displayName: "Kat Lim household",
        notes: row.notes,
        seatCount: row.seatCount,
        seats: row.seats.map((seat) => ({
          id: seat.id ?? seat.slot,
          name: seat.name ?? "",
          invitedName: seat.invitedName ?? undefined,
        })),
      },
      "host@example.com",
    );
    assert.equal(result.ok, true);
    assert.deepEqual(seatState(), before);
  } finally {
    Object.assign(row, original);
    row.seats = original.seats;
  }
});

test("fake add validates unique slug and creates a twelve-character-compatible ticket", async () => {
  const store = createFakeAdminStore();
  const first = await store.addHousehold(
    {
      label: "Alpha 2",
      displayName: "A new family",
      notes: null,
      seats: [{ name: "New Alpha" }],
    },
    "host@example.com",
  );
  const second = await store.addHousehold(
    {
      label: "Alpha-2",
      displayName: "Another family",
      notes: null,
      seats: [{ name: "Other Alpha" }],
    },
    "host@example.com",
  );
  assert.equal(second.id, `${first.id}-2`);
  const added = fakeAdminFixtures.filter(
    (row) => row.id === first.id || row.id === second.id,
  );
  assert.equal(
    added.every((row) =>
      /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(row.ticketCode ?? ""),
    ),
    true,
  );
  for (const row of added) {
    const index = fakeAdminFixtures.indexOf(row);
    if (index >= 0) fakeAdminFixtures.splice(index, 1);
  }
});

test("fake add uses the same duplicate and host ID rules", async () => {
  const store = createFakeAdminStore();
  const source = fakeAdminFixtures.find((row) => row.id === "hh-santos")!;
  const duplicate = source.seats.find((seat) => seat.name)!.name!;
  await assert.rejects(
    () =>
      store.addHousehold(
        {
          label: "FAKE_DUPLICATE",
          displayName: "Duplicate",
          notes: null,
          seats: [{ name: duplicate }],
        },
        "host@example.com",
      ),
    /already invited/,
  );
  await assert.rejects(
    () =>
      store.addHousehold(
        {
          label: source.label,
          displayName: "Another",
          notes: null,
          seats: [{ name: "Made Up Guest" }],
        },
        "host@example.com",
      ),
    /Host ID is already in use/,
  );
  const added = await store.addHousehold(
    {
      label: "FAKE_CONFIRMED",
      displayName: "Confirmed",
      notes: null,
      seats: [{ name: duplicate }],
      confirmedNames: [duplicate],
    },
    "host@example.com",
  );
  const index = fakeAdminFixtures.findIndex((row) => row.id === added.id);
  if (index >= 0) fakeAdminFixtures.splice(index, 1);
});

test("archive removes a household from every admin read surface", async () => {
  const database = setup();
  const d1 = createD1AdminStore(database);
  await d1.archiveHousehold("alpha", "host@example.com", now);
  assert.equal(
    (await d1.getGuestList()).rows.some((row) => row.id === "alpha"),
    false,
  );
  assert.equal((await d1.getOverview()).households.invited, 0);
  assert.equal(
    (await d1.getRsvpList()).rows.some((row) => row.id === "alpha"),
    false,
  );
  assert.equal(await d1.getRsvpDetail("alpha"), null);
  assert.equal((await d1.getNavCounts()).households, 0);
  assert.equal((await d1.getSlipperOrder()).pairs, 0);
  database.close();

  const fixture = fakeAdminFixtures.find(
    (row) => row.id === "hh-admin-editor",
  )!;
  const original = structuredClone(fixture);
  try {
    await createFakeAdminStore().archiveHousehold(
      fixture.id,
      "host@example.com",
      fixture.updatedAt,
    );
    const fake = createFakeAdminStore();
    assert.equal(
      (await fake.getGuestList()).rows.some((row) => row.id === fixture.id),
      false,
    );
    assert.equal(
      (await fake.getOverview()).households.invited,
      fakeAdminFixtures.filter((row) => row.id !== fixture.id).length,
    );
    assert.equal(
      (await fake.getRsvpList()).rows.some((row) => row.id === fixture.id),
      false,
    );
    assert.equal(await fake.getRsvpDetail(fixture.id), null);
    assert.equal(
      (await fake.getNavCounts()).households,
      fakeAdminFixtures.filter((row) => row.id !== fixture.id).length,
    );
  } finally {
    Object.assign(fixture, original);
    fixture.seats = original.seats;
  }
});
