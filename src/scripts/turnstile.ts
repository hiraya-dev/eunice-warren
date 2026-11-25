export interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string | number;
  execute: (widget: string | number | undefined) => void;
  reset: (widget: string | number | undefined) => void;
  remove: (widget: string | number | undefined) => void;
}

declare global {
  interface Window { turnstile?: TurnstileApi; }
}

export const isFakeTurnstileMode = (publicStore: string | undefined, dev: boolean) =>
  publicStore === "fake" || (dev && !publicStore);

export function createTurnstileController(fakeMode: boolean) {
  let widget: string | number | undefined;
  let closed = false;
  let prefetched: { token: string; createdAt: number } | undefined;
  let inFlight: Promise<string | undefined> | undefined;
  const stale = (value: { createdAt: number }) => Date.now() - value.createdAt >= 280_000;
  const consumePrefetched = () => {
    const current = prefetched;
    if (!current || stale(current)) return undefined;
    prefetched = undefined;
    return current.token;
  };
  const load = () => new Promise<void>((resolve, reject) => {
    if (window.turnstile) return resolve();
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile unavailable"));
    document.head.append(script);
  });
  const createToken = async (container: HTMLElement) => {
    await load();
    if (widget !== undefined) window.turnstile!.remove(widget);
    container.replaceChildren();
    return new Promise<string>((resolve, reject) => {
      widget = window.turnstile!.render(container, {
        sitekey: import.meta.env.PUBLIC_TURNSTILE_SITE_KEY || "0x4AAAAAAGLQ97oeYHLG-p4Y",
        appearance: "interaction-only",
        execution: "execute",
        callback: (token: string) => resolve(token),
        "error-callback": () => reject(new Error("Turnstile rejected")),
      });
      window.turnstile!.execute(widget);
    });
  };
  const prefetch = async (container: HTMLElement) => {
    if (fakeMode || closed || prefetched && !stale(prefetched) || inFlight) return inFlight;
    inFlight = createToken(container).then((token) => {
      if (!closed) prefetched = { token, createdAt: Date.now() };
      return token;
    }).catch(() => undefined).finally(() => { inFlight = undefined; });
    return inFlight;
  };
  const getToken = async (container: HTMLElement) => {
    if (fakeMode) return "local-test-token";
    if (closed) throw new Error("Turnstile unavailable");
    const ready = consumePrefetched();
    if (ready) return ready;
    prefetched = undefined;
    const pending = inFlight;
    if (pending) await pending;
    const awaited = consumePrefetched();
    if (awaited) return awaited;
    return createToken(container);
  };
  const reset = () => { if (!fakeMode) window.turnstile?.reset(widget); };
  const close = () => {
    closed = true;
    prefetched = undefined;
    if (!fakeMode && widget !== undefined) window.turnstile?.remove(widget);
    widget = undefined;
  };
  return { getToken, prefetch, reset, close };
}
