import { gsap, ScrollTrigger } from "@/scripts/scroll.ts";
import { Flip } from "gsap/Flip";

gsap.registerPlugin(Flip);

const FLIGHT_DURATION = 0.7;
const FLIGHT_EASE = "power3.inOut";
const FADE_DURATION = 0.2;

/**
 * Moves the song between its two homes: the polaroid in the hero (desktop) and the luggage tag
 * docked bottom-right. `data-music-docked` on the container is the state signal; while a flight
 * runs, `data-music-flying` keeps both homes visible. The two cards never share an element, and
 * the <audio> is not touched.
 *
 * From 64rem up, scroll drives it: past the polaroid the tag takes its place with a Flip, and
 * scrolling back reverses it. Reduced motion swaps the Flip for a 200ms crossfade. Below 64rem
 * the tag is simply docked.
 */
export function initMusicTeleport(container: HTMLElement) {
  const tag = container.querySelector<HTMLElement>("[data-music-tag]");
  const string = container.querySelector<HTMLElement>(".music-player_string");
  const polaroid = document.querySelector<HTMLElement>("[data-music-polaroid]");
  const card = polaroid?.querySelector<HTMLElement>(".music-polaroid_wrap");
  const hero = document.querySelector<HTMLElement>("#hero");
  const collage = hero?.querySelector<HTMLElement>(".hero_collage");
  const setDocked = (docked: boolean) => container.toggleAttribute("data-music-docked", docked);
  if (!tag || !polaroid || !card || !hero) {
    setDocked(true);
    return () => {};
  }

  const root = document.documentElement;
  const mm = gsap.matchMedia();
  let flight: gsap.core.Timeline | null = null;
  let flightDock = false;
  let reduced = false;

  const parts = () => [tag, card, string, ...Array.from(tag.children), ...Array.from(card.children)].filter(Boolean) as HTMLElement[];
  const lift = (on: boolean) => {
    // The card flies in from the tag, which can be well outside the hero's own box and behind its
    // text; open the hero up for the flight only.
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
      // Squashed contents would read as a glitch; let them arrive once the paper has its shape.
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

  // Below 48rem the tag is docked from the start and could sit on the hero's RSVP buttons on a short
  // phone. Step aside while the CTA group overlaps the tag's band at the bottom of the viewport (or
  // is still below it), and return once it has scrolled above. One observer, rebuilt on resize.
  const cta = hero.querySelector<HTMLElement>(".hero_actions");
  const ctaGuard = gsap.matchMedia();
  ctaGuard.add("(max-width: 47.999rem)", () => {
    if (!cta) return;
    const hidden = (value: boolean) => tag.toggleAttribute("data-music-hidden-for-cta", value);
    let observer: IntersectionObserver | null = null;
    let frame = 0;
    const observe = () => {
      observer?.disconnect();
      const band = container.offsetHeight + parseFloat(getComputedStyle(container).bottom) + 16;
      // The root becomes everything from the band's top edge down, so "intersecting" means the CTA's
      // bottom is below that line.
      observer = new IntersectionObserver(([entry]) => hidden(entry.isIntersecting), {
        rootMargin: `-${Math.max(0, window.innerHeight - band)}px 0px ${window.innerHeight * 10}px 0px`,
      });
      observer.observe(cta);
    };
    const onResize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(observe); };
    window.addEventListener("resize", onResize, { passive: true });
    observe();
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame);
      observer?.disconnect();
      hidden(false);
    };
  });

  const teardown = () => {
    ctaGuard.revert();
    mm.revert();
    settle(true);
  };
  document.addEventListener("astro:before-swap", teardown, { once: true });
  return teardown;
}
