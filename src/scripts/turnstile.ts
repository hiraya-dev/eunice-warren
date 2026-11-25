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
  let resolvePending: ((token: string) => void) | undefined;
  let rejectActive: ((reason: Error) => void) | undefined;
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
  const createToken = (container: HTMLElement) => {
    if (closed) return Promise.reject(new Error("Turnstile unavailable"));
    return new Promise<string>((resolve, reject) => {
      resolvePending = resolve;
      rejectActive = reject;
      void (async () => {
        try {
          await load();
          if (closed) throw new Error("Turnstile unavailable");
          if (widget === undefined) {
            container.replaceChildren();
            if (closed) throw new Error("Turnstile unavailable");
            widget = window.turnstile!.render(container, {
              sitekey: import.meta.env?.PUBLIC_TURNSTILE_SITE_KEY || "0x4AAAAAAGLQ97oeYHLG-p4Y",
              appearance: "interaction-only",
              execution: "execute",
              "refresh-expired": "auto",
              callback: (token: string) => {
                if (closed) return;
                prefetched = { token, createdAt: Date.now() };
                resolvePending?.(token);
                resolvePending = undefined;
                rejectActive = undefined;
              },
              "expired-callback": () => { prefetched = undefined; },
              "error-callback": () => {
                const fail = rejectActive;
                resolvePending = undefined;
                rejectActive = undefined;
                fail?.(new Error("Turnstile rejected"));
              },
            });
            if (closed) {
              window.turnstile?.remove(widget);
              widget = undefined;
              throw new Error("Turnstile unavailable");
            }
          }
          if (closed) throw new Error("Turnstile unavailable");
          window.turnstile!.reset(widget);
          if (closed) throw new Error("Turnstile unavailable");
          window.turnstile!.execute(widget);
        } catch (error) {
          if (rejectActive === reject) {
            resolvePending = undefined;
            rejectActive = undefined;
            reject(error instanceof Error ? error : new Error("Turnstile unavailable"));
          }
        }
      })();
    });
  };
  const prefetch = async (container: HTMLElement) => {
    if (fakeMode || closed || prefetched && !stale(prefetched) || inFlight) return inFlight;
    inFlight = createToken(container).catch(() => undefined).finally(() => { inFlight = undefined; });
    return inFlight;
  };
  const getToken = async (container: HTMLElement) => {
    if (fakeMode) return "local-test-token";
    if (closed) throw new Error("Turnstile unavailable");
    while (true) {
      const ready = consumePrefetched();
      if (ready) return ready;
      if (closed) throw new Error("Turnstile unavailable");
      if (!inFlight) {
        const execution = createToken(container);
        const pending = execution.finally(() => {
          if (inFlight === pending) inFlight = undefined;
        });
        inFlight = pending;
        try {
          await pending;
        } catch (error) {
          if (closed) throw new Error("Turnstile unavailable");
          throw error;
        }
      } else {
        await inFlight.catch(() => undefined);
      }
      if (closed) throw new Error("Turnstile unavailable");
    }
  };
  const reset = () => { if (!fakeMode && !closed && widget !== undefined) window.turnstile?.reset(widget); };
  const close = () => {
    closed = true;
    prefetched = undefined;
    rejectActive?.(new Error("Turnstile unavailable"));
    resolvePending = undefined;
    rejectActive = undefined;
    if (!fakeMode && widget !== undefined) window.turnstile?.remove(widget);
    widget = undefined;
  };
  return { getToken, prefetch, reset, close };
}
