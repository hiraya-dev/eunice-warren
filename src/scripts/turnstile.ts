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
  const getToken = async (container: HTMLElement) => {
    if (fakeMode) return "local-test-token";
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
    await load();
    if (widget !== undefined) window.turnstile!.remove(widget);
    container.replaceChildren();
    return new Promise<string>((resolve, reject) => {
      widget = window.turnstile!.render(container, {
        sitekey: import.meta.env.PUBLIC_TURNSTILE_SITE_KEY || "0x4AAAAAAFYIhA_8zh_lLnm8",
        appearance: "interaction-only",
        execution: "execute",
        callback: (token: string) => resolve(token),
        "error-callback": () => reject(new Error("Turnstile rejected")),
      });
      window.turnstile!.execute(widget);
    });
  };
  return { getToken, reset: () => { if (!fakeMode) window.turnstile?.reset(widget); } };
}
