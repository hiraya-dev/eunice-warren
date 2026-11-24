import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRsvpNotification,
  getRsvpNotificationConfig,
  parseNotifyTo,
  scheduleRsvpNotification,
  sendRsvpNotification,
} from "../src/lib/rsvp/notify.ts";
import { runSubmitAction } from "../src/lib/guest-actions.ts";
import { signRsvpToken } from "../src/lib/rsvp/logic.ts";
import type {
  RsvpNotificationData,
  SendEmailMessage,
} from "../src/lib/rsvp/notify.ts";
import type { PreviousRsvp, RsvpStore } from "../src/lib/rsvp/store.ts";

const data = (isUpdate = false): RsvpNotificationData => ({
  householdId: "household-1",
  householdName: "Fictional Family",
  respondentName: "Ada Fiction",
  isUpdate,
  submission: {
    inviteId: "household-1",
    name: "Ada Fiction",
    attending: true,
    guests: 1,
    email: "ada@example.test",
    note: "Please seat us near the stage.",
    seats: [
      {
        seatId: 1,
        shownName: "Ada Fiction",
        name: "Ada <script>alert(1)</script>",
        attending: true,
        slipperSize: "W 7",
      },
      {
        seatId: 2,
        shownName: "Bea Fiction",
        name: "Bea Fiction",
        attending: false,
      },
    ],
  },
});

const env = (binding: unknown = { send: async () => {} }) => ({
  RSVP_STORE: "d1",
  NOTIFY_TO: " host@example.test ",
  RSVP_EMAIL: binding,
});

test("uses New for a first reply and Updated for a later reply", () => {
  assert.match(
    buildRsvpNotification(data(false)).subject,
    /^New RSVP: Fictional Family$/,
  );
  assert.match(
    buildRsvpNotification(data(true)).subject,
    /^Updated RSVP: Fictional Family$/,
  );
});

test("includes every RSVP field in text and html, escaping guest values in html", () => {
  const message = buildRsvpNotification({
    ...data(),
    submission: {
      ...data().submission,
      note: "<script>alert('note')</script>",
    },
  });
  assert.match(
    message.text,
    /Ada <script>alert\(1\)<\/script> — Attending — slipper size: W 7/,
  );
  assert.match(message.text, /Bea Fiction — Declined/);
  assert.match(message.text, /<script>alert\('note'\)<\/script>/);
  assert.match(message.text, /ada@example\.test/);
  assert.match(message.text, /Ada Fiction/);
  assert.match(
    message.text,
    /https:\/\/thefisheswedding\.com\/admin\/rsvps\?household=household-1/,
  );
  assert.match(message.html, /Ada &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(message.html, /<script>alert/);
  assert.match(
    message.html,
    /&lt;script&gt;alert\(&#39;note&#39;\)&lt;\/script&gt;/,
  );
  assert.match(message.html, /ada@example\.test/);
});

test("strips control characters from the subject", () => {
  assert.equal(
    buildRsvpNotification({
      ...data(),
      householdName: "Fictional\r\nBcc: attacker@example.test",
    }).subject,
    "New RSVP: FictionalBcc: attacker@example.test",
  );
});

test("enables notifications only for the real store with recipients and a binding", () => {
  assert.equal(
    getRsvpNotificationConfig({ ...env(), RSVP_STORE: "fake" }),
    null,
  );
  assert.equal(getRsvpNotificationConfig({ ...env(), NOTIFY_TO: "  " }), null);
  assert.equal(
    getRsvpNotificationConfig({ ...env(), RSVP_EMAIL: undefined }),
    null,
  );
  assert.ok(getRsvpNotificationConfig(env()));
});

test("parses comma-separated recipients with spaces and empty entries", () => {
  assert.deepEqual(
    parseNotifyTo(" first@example.test, ,second@example.test ,"),
    ["first@example.test", "second@example.test"],
  );
});

test("passes the structured message to the injected Email Service binding", async () => {
  let message: SendEmailMessage | undefined;
  const binding = {
    send: async (next: SendEmailMessage) => {
      message = next;
    },
  };
  await sendRsvpNotification(data(), {
    RSVP_STORE: "d1",
    NOTIFY_TO: " first@example.test, second@example.test ",
    RSVP_EMAIL: binding,
  });
  assert.deepEqual(message?.from, {
    email: "rsvp@thefisheswedding.com",
    name: "Warren & Eunice RSVP",
  });
  assert.deepEqual(message?.to, ["first@example.test", "second@example.test"]);
  assert.equal(message?.replyTo, "ada@example.test");
  assert.equal(message?.subject, "New RSVP: Fictional Family");
});

test("swallows a rejected send and logs only safe error details", async () => {
  const logs: unknown[][] = [];
  const logger = { error: (...args: unknown[]) => logs.push(args) };
  await assert.doesNotReject(() =>
    sendRsvpNotification(
      data(),
      {
        ...env(),
        RSVP_EMAIL: {
          send: async () => {
            throw Object.assign(
              new Error("recipient ada@example.test rejected"),
              { code: "E_RECIPIENT_NOT_ALLOWED" },
            );
          },
        },
      },
      logger,
    ),
  );
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0], [
    "RSVP notification failed",
    {
      householdId: "household-1",
      code: "E_RECIPIENT_NOT_ALLOWED",
      message: "recipient [address] rejected",
    },
  ]);
});

const submitInput = {
  token: "",
  name: "Ada Fiction",
  attending: false,
  email: "ada@example.test",
  seats: [
    {
      seatId: 1,
      name: "Ada Fiction",
      shownName: "Ada Fiction",
      attending: false,
    },
  ],
};
const submitInvite = {
  id: "household-1",
  householdName: "Fictional Family",
  ticketCode: "HOUSE1",
  members: ["Ada Fiction"],
  seats: 1,
  seatList: [
    {
      seatId: 1,
      kind: "member" as const,
      invitedName: "Ada Fiction",
      name: "Ada Fiction",
    },
  ],
};

const submitStore = (previous: PreviousRsvp | null): RsvpStore => ({
  findInvite: async () => null,
  findInviteByTicketCode: async () => ({
    invite: submitInvite,
    householdId: "household-1",
    matchedName: "Ada Fiction",
    previous,
  }),
  submit: async () => {},
});

test("uses the store's previous response to mark New versus Updated", async () => {
  const token = await signRsvpToken("HOUSE1", Date.now() + 60_000, "secret");
  const states: boolean[] = [];
  await runSubmitAction(
    submitStore(null),
    { ...submitInput, token },
    "secret",
    (result) => states.push(result.isUpdate),
  );
  await runSubmitAction(
    submitStore({ attending: false, seats: [] }),
    { ...submitInput, token },
    "secret",
    (result) => states.push(result.isUpdate),
  );
  assert.deepEqual(states, [false, true]);
});

test("a rejected send does not change a successful submit result", async () => {
  const token = await signRsvpToken("HOUSE1", Date.now() + 60_000, "secret");
  const pending: Promise<unknown>[] = [];
  const logger = { error: () => {} };
  const result = await runSubmitAction(
    submitStore(null),
    { ...submitInput, token },
    "secret",
    (notification) => {
      scheduleRsvpNotification(
        notification,
        {
          ...env(),
          RSVP_EMAIL: {
            send: async () => {
              throw new Error("send failed");
            },
          },
        },
        (promise) => pending.push(promise),
        logger,
      );
    },
  );
  assert.deepEqual(result, { ok: true });
  await Promise.all(pending);
});

test("scheduling without waitUntil still swallows a rejected send", async () => {
  const logs: unknown[][] = [];
  const logger = { error: (...args: unknown[]) => logs.push(args) };
  assert.doesNotThrow(() =>
    scheduleRsvpNotification(
      data(),
      {
        ...env(),
        RSVP_EMAIL: {
          send: async () => {
            throw new Error("send failed");
          },
        },
      },
      undefined,
      logger,
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(logs.length, 1);
});

test("a failed submit never calls the sender", async () => {
  const token = await signRsvpToken("HOUSE1", Date.now() + 60_000, "secret");
  let sends = 0;
  const store: RsvpStore = {
    findInvite: async () => null,
    findInviteByTicketCode: async () => ({ invite: null }),
    submit: async () => {},
  };
  await assert.rejects(() =>
    runSubmitAction(store, { ...submitInput, token }, "secret", () => {
      sends += 1;
    }),
  );
  assert.equal(sends, 0);
});
