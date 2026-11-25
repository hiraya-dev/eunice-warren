import test from "node:test";
import assert from "node:assert/strict";
import { createTurnstileController } from "../src/scripts/turnstile.ts";

type Callbacks = { callback: (token: string) => void; error: () => void };
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

const setup = (withApi = true) => {
  let now = 1_000_000;
  const scripts: Array<{ onload?: () => void; onerror?: () => void }> = [];
  const renders: Callbacks[] = [];
  const removed: Array<string | number | undefined> = [];
  const resets: Array<string | number | undefined> = [];
  let nextWidget = 1;
  const api = {
    render: (_container: HTMLElement, options: Record<string, unknown>) => {
      renders.push({ callback: options.callback as (token: string) => void, error: options["error-callback"] as () => void });
      return `widget-${nextWidget++}`;
    },
    execute: () => {},
    reset: (widget: string | number | undefined) => resets.push(widget),
    remove: (widget: string | number | undefined) => removed.push(widget),
  };
  const windowStub = withApi ? { turnstile: api } : {};
  const documentStub = {
    createElement: () => ({ src: "", async: false, defer: false, onload: undefined as (() => void) | undefined, onerror: undefined as (() => void) | undefined }),
    head: { append: (script: (typeof scripts)[number]) => scripts.push(script) },
  };
  const oldWindow = (globalThis as { window?: unknown }).window;
  const oldDocument = (globalThis as { document?: unknown }).document;
  const oldNow = Date.now;
  (globalThis as { window: unknown }).window = windowStub;
  (globalThis as { document: unknown }).document = documentStub;
  Date.now = () => now;
  return {
    container: { replaceChildren: () => {} } as unknown as HTMLElement,
    api,
    renders,
    removed,
    resets,
    scripts,
    setNow: (value: number) => { now = value; },
    cleanup: () => {
      Date.now = oldNow;
      (globalThis as { window?: unknown }).window = oldWindow;
      (globalThis as { document?: unknown }).document = oldDocument;
    },
  };
};

test("consumes a prefetched token once, then renders for the next token", async () => {
  const env = setup();
  try {
    const controller = createTurnstileController(false);
    const prefetch = controller.prefetch(env.container);
    await tick();
    env.renders[0].callback("prefetched");
    await prefetch;
    assert.equal(await controller.getToken(env.container), "prefetched");
    const fresh = controller.getToken(env.container);
    await tick();
    env.renders[1].callback("fresh");
    assert.equal(await fresh, "fresh");
    assert.equal(env.renders.length, 2);
  } finally { env.cleanup(); }
});

test("getToken awaits an in-flight prefetch without rendering twice", async () => {
  const env = setup(false);
  try {
    const controller = createTurnstileController(false);
    const prefetch = controller.prefetch(env.container);
    const token = controller.getToken(env.container);
    assert.equal(env.scripts.length, 1);
    (globalThis.window as { turnstile?: unknown }).turnstile = env.api;
    env.scripts[0].onload?.();
    await tick();
    assert.equal(env.renders.length, 1);
    env.renders[0].callback("in-flight");
    assert.equal(await prefetch, "in-flight");
    assert.equal(await token, "in-flight");
  } finally { env.cleanup(); }
});

test("stale prefetched and failed prefetched tokens are replaced with fresh renders", async () => {
  const env = setup();
  try {
    const controller = createTurnstileController(false);
    const first = controller.prefetch(env.container);
    await tick();
    env.renders[0].callback("stale");
    await first;
    env.setNow(1_280_000);
    const fresh = controller.getToken(env.container);
    await tick();
    env.renders[1].callback("fresh");
    assert.equal(await fresh, "fresh");

    const failed = controller.prefetch(env.container);
    await tick();
    env.renders[2].error();
    assert.equal(await failed, undefined);
    const recovered = controller.getToken(env.container);
    await tick();
    env.renders[3].callback("recovered");
    assert.equal(await recovered, "recovered");
  } finally { env.cleanup(); }
});

test("close while loading prevents rendering and rejects pending callers", async () => {
  const env = setup(false);
  try {
    const controller = createTurnstileController(false);
    const prefetch = controller.prefetch(env.container);
    const token = controller.getToken(env.container);
    controller.close();
    assert.equal(await prefetch, undefined);
    await assert.rejects(token, /Turnstile unavailable/);
    let renderCalls = 0;
    let removeCalls = 0;
    let cleared = 0;
    const container = env.container as unknown as { replaceChildren: () => void };
    container.replaceChildren = () => { cleared += 1; };
    (globalThis.window as { turnstile?: unknown }).turnstile = {
      ...env.api,
      render: () => { renderCalls += 1; return "late-widget"; },
      remove: () => { removeCalls += 1; },
    };
    env.scripts[0].onload?.();
    await tick();
    await tick();
    await tick();
    assert.equal(renderCalls, 0);
    assert.equal(removeCalls, 0);
    assert.equal(cleared, 0);
  } finally { env.cleanup(); }
});

test("close while awaiting a token removes the widget, rejects, and reset is guarded", async () => {
  const env = setup();
  try {
    const controller = createTurnstileController(false);
    const token = controller.getToken(env.container);
    await tick();
    assert.equal(env.renders.length, 1);
    controller.close();
    controller.reset();
    await assert.rejects(token, /Turnstile unavailable/);
    assert.deepEqual(env.removed, ["widget-1"]);
    assert.deepEqual(env.resets, []);
  } finally { env.cleanup(); }
});

test("fake mode returns the local token without rendering", async () => {
  const env = setup();
  try {
    const controller = createTurnstileController(true);
    assert.equal(await controller.getToken(env.container), "local-test-token");
    await controller.prefetch(env.container);
    assert.equal(env.renders.length, 0);
  } finally { env.cleanup(); }
});
