import { gsap, ScrollTrigger } from "@/scripts/scroll.ts";
import { Flip } from "gsap/Flip";

gsap.registerPlugin(Flip);

const FLIGHT_DURATION = 0.7;
const FLIGHT_EASE = "power3.inOut";
const FADE_DURATION = 0.2;

function watchBand(
  container: HTMLElement,
  surface: HTMLElement,
  target: HTMLElement | null | undefined,
  attribute: string,
  below = false,
  horizontal = false,
  onHide?: (hidden: boolean) => void,
  footprint: () => HTMLElement = () => surface,
) {
  if (!target) return () => {};
  const set = (value: boolean) => { surface.toggleAttribute(attribute, value); onHide?.(value); };
  let observer: IntersectionObserver | null = null;
  let frame = 0;
  const observe = () => {
    observer?.disconnect();
    const styles = getComputedStyle(container);
    const bottom = parseFloat(styles.bottom) || 0;
    const right = parseFloat(styles.right) || 0;
    const shape = footprint();
    const bandHeight = shape.offsetHeight + bottom + 16;
    const bandWidth = shape.offsetWidth + right + 16;
    const left = horizontal ? -Math.max(0, window.innerWidth - bandWidth) : 0;
    observer = new IntersectionObserver(([entry]) => set(entry.isIntersecting), {
      rootMargin: `-${Math.max(0, window.innerHeight - bandHeight)}px 0px ${below ? window.innerHeight * 10 : 0}px ${left}px`,
    });
    observer.observe(target);
  };
  const onResize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(observe); };
  window.addEventListener("resize", onResize, { passive: true });
  observe();
  return () => {
    window.removeEventListener("resize", onResize);
    cancelAnimationFrame(frame);
    observer?.disconnect();
    set(false);
  };
}

export function initMusicTeleport(container: HTMLElement) {
  const tag = container.querySelector<HTMLElement>("[data-music-tag]");
  const pill = container.querySelector<HTMLElement>("[data-music-pill]");
  const disc = container.querySelector<HTMLButtonElement>("[data-music-disc]");
  const controls = container.querySelector<HTMLElement>("[data-music-controls]");
  const string = container.querySelector<HTMLElement>(".music-player_string");
  const polaroid = document.querySelector<HTMLElement>("[data-music-polaroid]");
  const card = polaroid?.querySelector<HTMLElement>(".music-polaroid_wrap");
  const hero = document.querySelector<HTMLElement>("#hero");
  const collage = hero?.querySelector<HTMLElement>(".hero_collage");
  const setDocked = (docked: boolean) => container.toggleAttribute("data-music-docked", docked);
  if (!tag || !pill || !disc || !controls) {
    setDocked(true);
    return () => {};
  }
  const mobile = window.matchMedia("(max-width: 47.999rem)");
  let formGuard = () => {};
  let ctaGuard = () => {};
  let embedGuard = () => {};
  let footerGuard = () => {};
  let guardRefresh = 0;
  let introTimer = 0;
  let openedAt = 0;
  let interacted = false;
  let keyboardOpen = false;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const crossfade = (opening: boolean) => {
    if (!reduceMotion.matches) return;
    for (const element of [pill.querySelector<HTMLElement>(".music-player_wipe"), controls]) {
      element?.animate({ opacity: [getComputedStyle(element).opacity, opening ? "1" : "0"] }, { duration: 150, easing: "linear" });
    }
  };
  const hidden = () => container.querySelector<HTMLElement>("[data-music-hidden-for-input], [data-music-hidden-for-cta], [data-music-hidden-for-form], [data-music-hidden-for-embed], [data-music-hidden-for-footer]") !== null;
  const close = (returnFocus = false) => {
    if (!container.hasAttribute("data-music-open")) return;
    crossfade(false);
    container.removeAttribute("data-music-open");
    controls.inert = true;
    controls.setAttribute("aria-hidden", "true");
    disc.setAttribute("aria-expanded", "false");
    disc.setAttribute("aria-label", `Show player for ${disc.dataset.songName || "the song"}`);
    if (returnFocus && controls.contains(document.activeElement)) disc.focus();
    window.clearTimeout(introTimer);
    scheduleGuards();
  };
  const blocked = () => {
    const shape = pill.getBoundingClientRect();
    return ([["#rsvp .rsvp_card", false], ["#hero .hero_actions", true], ["[data-playlist-embed]", false], [".footer_top-link", false]] as const).some(([selector, below]) => {
      const box = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
      if (!box) return false;
      return box.right > shape.left - 16 && box.bottom > shape.top - 16 && (below || box.top < window.innerHeight);
    });
  };
  const open = (focus = false, automatic = false) => {
    if (!mobile.matches || hidden() || blocked()) return;
    crossfade(true);
    container.setAttribute("data-music-open", "");
    controls.inert = false;
    controls.removeAttribute("aria-hidden");
    disc.setAttribute("aria-expanded", "true");
    disc.setAttribute("aria-label", `Hide player for ${disc.dataset.songName || "the song"}`);
    if (focus) pill.querySelector<HTMLButtonElement>("[data-music-toggle]")?.focus();
    scheduleGuards();
    if (automatic) introTimer = window.setTimeout(() => { if (!interacted) close(); }, 3000);
  };
  const scheduleGuards = () => {
    cancelAnimationFrame(guardRefresh);
    guardRefresh = requestAnimationFrame(() => rebuildGuards());
  };
  const rebuildGuards = () => {
    formGuard();
    ctaGuard();
    embedGuard();
    footerGuard();
    if (mobile.matches) {
      const onHide = (value: boolean) => { if (value) close(false); };
      const footprint = () => (container.hasAttribute("data-music-open") ? pill : disc);
      formGuard = watchBand(container, pill, document.querySelector<HTMLElement>("#rsvp .rsvp_card"), "data-music-hidden-for-form", false, true, onHide, footprint);
      ctaGuard = watchBand(container, pill, document.querySelector<HTMLElement>("#hero .hero_actions"), "data-music-hidden-for-cta", true, true, onHide, footprint);
      embedGuard = watchBand(container, pill, document.querySelector<HTMLElement>("[data-playlist-embed]"), "data-music-hidden-for-embed", false, true, onHide, footprint);
      footerGuard = watchBand(container, pill, document.querySelector<HTMLElement>(".footer_top-link"), "data-music-hidden-for-footer", false, true, onHide, footprint);
    } else {
      formGuard = watchBand(container, tag, document.querySelector<HTMLElement>("#rsvp .rsvp_card"), "data-music-hidden-for-form");
      embedGuard = watchBand(container, tag, document.querySelector<HTMLElement>("[data-playlist-embed]"), "data-music-hidden-for-embed");
      footerGuard = watchBand(container, tag, document.querySelector<HTMLElement>(".footer_top-link"), "data-music-hidden-for-footer");
    }
  };
  const onBreakpoint = () => { if (!mobile.matches) close(false); scheduleGuards(); };
  mobile.addEventListener("change", onBreakpoint);
  const outside = (event: PointerEvent) => { if (container.hasAttribute("data-music-open") && !container.contains(event.target as Node)) close(false); };
  const onScroll = () => { if (container.hasAttribute("data-music-open") && Math.abs(window.scrollY - openedAt) > 40) close(false); };
  const onKeydown = (event: KeyboardEvent) => { if (event.key === "Escape" && container.hasAttribute("data-music-open")) { event.preventDefault(); close(true); } };
  const onDiscKeydown = (event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") keyboardOpen = true; };
  const onDiscClick = () => {
    interacted = true;
    if (container.hasAttribute("data-music-open")) close(true);
    else { openedAt = window.scrollY; open(keyboardOpen); }
    keyboardOpen = false;
  };
  controls.inert = true;
  controls.setAttribute("aria-hidden", "true");
  disc.addEventListener("keydown", onDiscKeydown);
  disc.addEventListener("click", onDiscClick);
  const hiddenObserver = new MutationObserver(() => { if (hidden()) close(false); });
  hiddenObserver.observe(container, { attributes: true, subtree: true });
  let introRetry = 0;
  const startIntro = (attempt = 0) => {
    if (!mobile.matches || !document.documentElement.classList.contains("ew-preloader-pending") || interacted) return;
    open(false, true);
    if (!container.hasAttribute("data-music-open") && hidden() && attempt < 10) introRetry = window.setTimeout(() => startIntro(attempt + 1), 100);
  };
  let musicStartRequested = false;
  const onMusicStart = () => { musicStartRequested = true; };
  const onPreloaderClose = () => { if (musicStartRequested) startIntro(); };
  document.addEventListener("ew:music-start", onMusicStart);
  document.addEventListener("ew:preloader-close", onPreloaderClose, { once: true });
  window.addEventListener("pointerdown", outside, { capture: true, passive: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("keydown", onKeydown);
  scheduleGuards();
  const clearMobile = () => {
    window.clearTimeout(introTimer);
    window.clearTimeout(introRetry);
    hiddenObserver.disconnect();
    mobile.removeEventListener("change", onBreakpoint);
    disc.removeEventListener("keydown", onDiscKeydown);
    disc.removeEventListener("click", onDiscClick);
    window.removeEventListener("pointerdown", outside, true);
    window.removeEventListener("scroll", onScroll);
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("ew:music-start", onMusicStart);
  };
  if (!polaroid || !card || !hero) {
    setDocked(true);
    return () => { clearMobile(); formGuard(); ctaGuard(); embedGuard(); footerGuard(); };
  }

  const root = document.documentElement;
  const mm = gsap.matchMedia();
  let flight: gsap.core.Timeline | null = null;
  let flightDock = false;
  let reduced = false;

  const parts = () => [tag, card, string, ...Array.from(tag.children), ...Array.from(card.children)].filter(Boolean) as HTMLElement[];
  const lift = (on: boolean) => {
    hero.style.overflowY = on ? "visible" : "";
    hero.style.zIndex = on ? "5" : "";
    if (collage) collage.style.zIndex = on ? "2" : "";
  };
  const settle = (docked: boolean) => {
    flight?.kill();
    flight = null;
    container.removeAttribute("data-music-flying");
    setDocked(docked);
    gsap.set(parts(), { clearProps: "all" });
    lift(false);
  };

  const canFly = () =>
    tag.hasAttribute("data-music-visible") &&
    !root.classList.contains("ew-preloader-pending") &&
    !("heroEntering" in hero.dataset) &&
    !document.hidden;

  const fly = (dock: boolean) => {
    const flier = dock ? tag : card;
    const source = dock ? card : tag;
    flightDock = dock;
    container.setAttribute("data-music-flying", "");
    setDocked(dock);
    if (!dock && !reduced) lift(true);

    const tl = gsap.timeline({
      onComplete: () => settle(dock),
      onReverseComplete: () => settle(!dock),
    });
    flight = tl;
    tl.fromTo(flier, { opacity: 0 }, { opacity: 1, duration: FADE_DURATION, ease: "none" }, 0);
    tl.to(source, { opacity: 0, duration: FADE_DURATION, ease: "none" }, 0);
    if (string) tl.fromTo(string, { opacity: dock ? 0 : 1 }, { opacity: dock ? 1 : 0, duration: FADE_DURATION, ease: "none" }, dock ? FLIGHT_DURATION * 0.7 : 0);

    if (!reduced) {
      const rotation = Number(gsap.getProperty(flier, "rotation"));
      Flip.fit(flier, source, { scale: true });
      const from = {
        x: Number(gsap.getProperty(flier, "x")),
        y: Number(gsap.getProperty(flier, "y")),
        scaleX: Number(gsap.getProperty(flier, "scaleX")),
        scaleY: Number(gsap.getProperty(flier, "scaleY")),
        rotation: Number(gsap.getProperty(flier, "rotation")),
      };
      tl.fromTo(flier, from, { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation, duration: FLIGHT_DURATION, ease: FLIGHT_EASE }, 0);
      tl.fromTo(Array.from(flier.children), { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out" }, FLIGHT_DURATION * 0.55);
    }
  };

  const request = (dock: boolean) => {
    if (flight) {
      const heading = flight.reversed() ? !flightDock : flightDock;
      if (heading === dock) return;
      setDocked(dock);
      flight.reversed(!flight.reversed());
      return;
    }
    if (container.hasAttribute("data-music-docked") === dock) return;
    if (!canFly()) { setDocked(dock); return; }
    fly(dock);
  };

  mm.add({ desktop: "(min-width: 64rem)", reduce: "(prefers-reduced-motion: reduce)" }, (context) => {
    const conditions = (context.conditions || {}) as Record<string, boolean>;
    if (!conditions.desktop) {
      settle(true);
      return;
    }
    reduced = Boolean(conditions.reduce);
    const trigger = ScrollTrigger.create({
      trigger: polaroid,
      start: "top 35%",
      end: "max",
      invalidateOnRefresh: true,
      onEnter: () => request(true),
      onLeaveBack: () => request(false),
    });
    settle(trigger.scroll() >= trigger.start);
    return () => {
      trigger.kill();
      settle(true);
    };
  });

  const teardown = () => {
    clearMobile();
    cancelAnimationFrame(guardRefresh);
    formGuard();
    ctaGuard();
    embedGuard();
    footerGuard();
    mm.revert();
    settle(true);
  };
  document.addEventListener("astro:before-swap", teardown, { once: true });
  return teardown;
}
