import test from "node:test";
import assert from "node:assert/strict";
import { isJpeg, isTodayInManila, stripControls } from "../src/lib/with-love/validation.ts";
import { createSheetsLoveStore, parseNoteRows, sortVisibleNotes } from "../src/lib/with-love/store.ts";
import { sampleFillCount } from "../src/lib/with-love/logic.ts";
import { isFakeTurnstileMode } from "../src/scripts/turnstile.ts";
import { clampPan, clampZoom, coverScale, pinchZoom, sourceRect } from "../src/scripts/with-love/crop.ts";

const serviceAccount = async () => {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const bytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return JSON.stringify({ client_email: "test@example.com", private_key: `-----BEGIN PRIVATE KEY-----\n${btoa(binary)}\n-----END PRIVATE KEY-----` });
};

test("validates JPEG magic bytes and sanitises controls", () => {
  assert.equal(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0x00])), true);
  assert.equal(isJpeg(new Uint8Array([0x89, 0x50, 0x4e])), false);
  assert.equal(stripControls("  hello\u0000\nworld  "), "helloworld");
});

test("buckets dates in Asia/Manila", () => {
  assert.equal(isTodayInManila("2026-01-01T16:00:00.000Z", new Date("2026-01-02T00:00:00+08:00")), true);
  assert.equal(isTodayInManila("2026-01-01T15:00:00.000Z", new Date("2026-01-02T00:00:00+08:00")), false);
});

test("filters hidden notes, sorts newest first, and limits the list", () => {
  const notes = parseNoteRows([
    ["old", "2026-01-01T00:00:00Z", "Old", "", "old", "notes/old.jpg", "FALSE"],
    ["hidden", "2026-01-03T00:00:00Z", "Hidden", "", "hidden", "notes/hidden.jpg", "TRUE"],
    ["new", "2026-01-02T00:00:00Z", "New", "", "new", "notes/new.jpg", false],
  ]);
  assert.deepEqual(sortVisibleNotes(notes, 1).map((note) => note.id), ["new"]);
});

test("fills the stack to six only when fewer than three real notes exist", () => {
  assert.equal(sampleFillCount(0, 6), 6);
  assert.equal(sampleFillCount(2, 6), 4);
  assert.equal(sampleFillCount(3, 6), 0);
});

test("uses the real Turnstile path outside fake mode", () => {
  assert.equal(isFakeTurnstileMode(undefined, false), false);
  assert.equal(isFakeTurnstileMode("fake", false), true);
});

test("calculates cover scales for landscape, portrait, and square images", () => {
  assert.equal(coverScale({ width: 1600, height: 900 }, { width: 800, height: 700 }), 700 / 900);
  assert.equal(coverScale({ width: 900, height: 1600 }, { width: 800, height: 700 }), 800 / 900);
  assert.equal(coverScale({ width: 1000, height: 1000 }, { width: 800, height: 700 }), 0.8);
});

test("clamps zoom and pan to the image edges", () => {
  assert.equal(clampZoom(9), 4);
  assert.equal(clampZoom(0), 1);
  assert.deepEqual(
    clampPan({ zoom: 2, panX: 9999, panY: -9999 }, { width: 1000, height: 875 }, { width: 800, height: 700 }),
    { zoom: 2, panX: 400, panY: -350 },
  );
  assert.equal(pinchZoom(1, 100, 250), 2.5);
});

test("returns an 8:7 source crop without upscaling", () => {
  const rect = sourceRect({ zoom: 1, panX: 0, panY: 0 }, { width: 2400, height: 1600 }, { width: 800, height: 700 });
  const outputWidth = Math.min(1600, Math.floor(rect.width));
  assert.equal(Math.round(outputWidth * 7 / 8), Math.round(outputWidth * rect.height / rect.width));
  assert.equal(outputWidth <= 1600, true);
  const edge = sourceRect({ zoom: 4, panX: 9999, panY: -9999 }, { width: 2400, height: 1600 }, { width: 800, height: 700 });
  assert.equal(edge.x + edge.width <= 2400, true);
  assert.equal(edge.y >= 0, true);
});

test("caches Notes reads and invalidates after a successful append", async () => {
  const originalFetch = globalThis.fetch;
  let notesReads = 0;
  let append = false;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }));
    if (url.includes("values/Notes!A2:G")) { notesReads += 1; return new Response(JSON.stringify({ values: [] })); }
    if (url.includes("values/Notes!A:G:append")) { append = true; return new Response(JSON.stringify({})); }
    return new Response(JSON.stringify({}));
  };
  try {
    const photos = { put: async () => {}, delete: async () => {}, get: async () => null };
    const store = createSheetsLoveStore({
      GOOGLE_SERVICE_ACCOUNT_JSON: await serviceAccount(),
      GOOGLE_SHEET_ID: "sheet",
      WITH_LOVE_PHOTOS: photos,
    });
    await store.listNotes();
    await store.listNotes();
    assert.equal(notesReads, 1);
    await store.addNote({ id: "cached-note", submittedAt: new Date().toISOString(), name: "Name", city: "", message: "Message", photoKey: "notes/cached-note.jpg" }, new Uint8Array([1]));
    assert.equal(append, true);
    await store.listNotes();
    assert.equal(notesReads, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test("deletes the KV object when appending the Sheet row fails", async () => {
  const originalFetch = globalThis.fetch;
  let deleted = "";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }));
    if (url.includes("values/Notes!A:G:append")) return new Response("failed", { status: 500 });
    return new Response(JSON.stringify({ values: [] }));
  };
  try {
    const photos = { put: async () => {}, delete: async (key: string) => { deleted = key; }, get: async () => null };
    const store = createSheetsLoveStore({ GOOGLE_SERVICE_ACCOUNT_JSON: await serviceAccount(), GOOGLE_SHEET_ID: "sheet", WITH_LOVE_PHOTOS: photos });
    await assert.rejects(() => store.addNote({ id: "orphan", submittedAt: new Date().toISOString(), name: "Name", city: "", message: "Message", photoKey: "notes/orphan.jpg" }, new Uint8Array([1])));
    assert.equal(deleted, "notes/orphan.jpg");
  } finally { globalThis.fetch = originalFetch; }
});
