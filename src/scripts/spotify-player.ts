export type SpotifyPlayerState =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "blocked";

export const MUSIC_PREFERENCE_KEY = "ew-music-v1";

export const rememberMusicPaused = () => {
  try {
    window.localStorage.setItem(MUSIC_PREFERENCE_KEY, JSON.stringify({ paused: true, at: new Date().toISOString() }));
  } catch {
    // Storage may be disabled; playback remains usable without the preference.
  }
};

export const clearMusicPreference = () => {
  try {
    window.localStorage.removeItem(MUSIC_PREFERENCE_KEY);
  } catch {
    // Storage may be disabled; playback remains usable without the preference.
  }
};

interface SpotifyPlaybackEvent {
  data: { isPaused: boolean; position: number; duration: number };
}

interface SpotifyController {
  addListener(
    event: string,
    callback: (event: SpotifyPlaybackEvent) => void,
  ): void;
  play(): void;
  pause(): void;
}

interface SpotifyAPI {
  createController(
    element: HTMLElement,
    options: { uri: string; width: string; height: number; theme: "dark" },
    callback: (controller: SpotifyController) => void,
  ): void;
}

interface SpotifyWindow extends Window {
  IFrameAPI?: SpotifyAPI;
  onSpotifyIframeApiReady?: (api: SpotifyAPI) => void;
}

type Listener = (state: SpotifyPlayerState) => void;

let state: SpotifyPlayerState = "idle";
let controller: SpotifyController | undefined;
let loadingStarted = false;
let pendingPlay = false;
let failTimeout: number | undefined;
let blockedTimeout: number | undefined;
const listeners = new Set<Listener>();

const setState = (next: SpotifyPlayerState) => {
  if (state === next) return;
  state = next;
  listeners.forEach((listener) => listener(state));
};

const clearBlockedTimeout = () => {
  if (blockedTimeout !== undefined) window.clearTimeout(blockedTimeout);
  blockedTimeout = undefined;
};

const fail = (embed?: HTMLElement | null) => {
  if (failTimeout !== undefined) window.clearTimeout(failTimeout);
  failTimeout = undefined;
  if (embed?.querySelector("iframe")) embed.classList.add("is-ready");
  setState("blocked");
};

const requestPlay = () => {
  if (!controller) {
    pendingPlay = true;
    ensureSpotifyPlayer();
    return;
  }
  pendingPlay = false;
  clearBlockedTimeout();
  controller.play();
  blockedTimeout = window.setTimeout(() => {
    if (state !== "playing") setState("blocked");
  }, 3000);
};

const createController = (api: SpotifyAPI) => {
  if (controller) return;
  const embed = document.querySelector<HTMLElement>("[data-playlist-embed]");
  const target = document.querySelector<HTMLElement>(
    "[data-playlist-embed-target]",
  );
  const uri = embed?.dataset.uri;
  if (!embed || !target || !uri) return;
  api.createController(
    target,
    { uri, width: "100%", height: 80, theme: "dark" },
    (created) => {
      controller = created;
      embed.querySelector<HTMLIFrameElement>("iframe")?.setAttribute(
        "loading",
        "eager",
      );
      embed.classList.add("is-ready");
      if (failTimeout !== undefined) window.clearTimeout(failTimeout);
      failTimeout = undefined;
      controller.addListener("playback_update", (event) => {
        clearBlockedTimeout();
        setState(event.data.isPaused ? "paused" : "playing");
      });
      setState("idle");
      if (pendingPlay) requestPlay();
    },
  );
};

/** True when this page has the Playlist section's Spotify embed. */
export const hasSpotifyEmbed = () =>
  Boolean(document.querySelector("[data-playlist-embed]"));

export const ensureSpotifyPlayer = () => {
  if (loadingStarted || !hasSpotifyEmbed()) return;
  loadingStarted = true;
  setState("loading");
  const spotifyWindow = window as SpotifyWindow;
  if (spotifyWindow.IFrameAPI) {
    createController(spotifyWindow.IFrameAPI);
    return;
  }
  spotifyWindow.onSpotifyIframeApiReady = createController;
  const script = document.createElement("script");
  script.src = "https://open.spotify.com/embed/iframe-api/v1";
  script.async = true;
  script.addEventListener("error", () => fail(document.querySelector("[data-playlist-embed]")), { once: true });
  document.head.appendChild(script);
  failTimeout = window.setTimeout(() => {
    if (!controller) fail(document.querySelector("[data-playlist-embed]"));
  }, 10000);
};

export const getSpotifyPlayerState = () => state;

export const hasSpotifyController = () => Boolean(controller);

export const subscribeSpotifyPlayer = (listener: Listener) => {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
};

export const playSpotify = () => {
  ensureSpotifyPlayer();
  requestPlay();
};

export const pauseSpotify = () => {
  pendingPlay = false;
  clearBlockedTimeout();
  if (controller) controller.pause();
};

export const toggleSpotify = () => {
  if (state === "playing") pauseSpotify();
  else playSpotify();
};

ensureSpotifyPlayer();
