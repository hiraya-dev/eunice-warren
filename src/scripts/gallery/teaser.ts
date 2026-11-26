import { gsap, ScrollTrigger } from "@/scripts/scroll.ts";

type Tier = "near" | "mid" | "far";

const TRAVEL: Record<Tier, number> = { near: 14, mid: 8, far: 4 };
const TIER_ORDER: Record<Tier, number> = { near: 0, mid: 1, far: 2 };
const FOLLOW = 0.22;
const SETTLED = 0.02;
const REVEAL_STEP = 0.045;
const WIDE_FROM = 1280;
const travelScale = (width: number) =>
  width < WIDE_FROM ? 1 : Math.min(1, 0.3 + (0.7 * (width - WIDE_FROM)) / 100);

const REDUCED = "(prefers-reduced-motion: reduce)";
const FINE = "(hover: hover) and (pointer: fine)";

type Teaser = { section: HTMLElement; destroy: () => void };
let current: Teaser | null = null;

const tierOf = (slot: HTMLElement): Tier =>
  slot.classList.contains("near") ? "near" : slot.classList.contains("mid") ? "mid" : "far";

function setupReveal(section: HTMLElement, slots: HTMLElement[]) {
  if (window.matchMedia(REDUCED).matches) return () => {};

  const polaroids = slots
    .map((slot) => slot.querySelector<HTMLElement>(".gallery_polaroid"))
    .filter((polaroid): polaroid is HTMLElement => Boolean(polaroid));
  if (!polaroids.length) return () => {};

  const context = gsap.context(() => {
    polaroids.forEach((polaroid, index) => {
      const tilt = parseFloat(getComputedStyle(slots[index]).rotate) || 0;
      const sign = tilt === 0 ? (index % 2 ? 1 : -1) : Math.sign(tilt);
      gsap.set(polaroid, { opacity: 0, scale: 1.06, y: 12, rotation: sign * 4 });
    });
    section.dataset.teaserReveal = "pending";

    const play = () => {
      const box = section.getBoundingClientRect();
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      const ranked = slots
        .map((slot, index) => {
          const rect = slot.getBoundingClientRect();
          const visible = rect.width > 0;
          const distance = visible
            ? Math.hypot(rect.left + rect.width / 2 - cx, rect.top + rect.height / 2 - cy)
            : Infinity;
          return { index, visible, distance, tier: TIER_ORDER[tierOf(slot)] };
        })
        .sort((a, b) => a.tier - b.tier || a.distance - b.distance);

      let rank = 0;
      let pending = ranked.length;
      ranked.forEach((entry, order) => {
        const delay = entry.visible ? rank++ * REVEAL_STEP : (order % 4) * REVEAL_STEP;
        gsap.to(polaroids[entry.index], {
          opacity: 1,
          scale: 1,
          y: 0,
          rotation: 0,
          duration: 0.9,
          delay,
          ease: "power3.out",
          clearProps: "transform,opacity",
          onComplete: () => {
            pending -= 1;
            if (!pending) section.dataset.teaserReveal = "done";
          },
        });
      });
    };

    ScrollTrigger.create({ trigger: section, start: "top 85%", once: true, onEnter: play });
  }, section);

  return () => {
    context.revert();
    delete section.dataset.teaserReveal;
  };
}

function setupParallax(section: HTMLElement, slots: HTMLElement[]) {
  const tiers = slots.map((slot) => TRAVEL[tierOf(slot)]);
  const x = slots.map(() => 0);
  const y = slots.map(() => 0);
  const overlay = section.querySelector<HTMLElement>("[data-gallery-overlay]");

  let pointer: { x: number; y: number } | null = null;
  let frame = 0;
  let last = 0;
  let observer: IntersectionObserver | null = null;
  let bound = false;

  const write = () => {
    slots.forEach((slot, index) => {
      slot.style.translate =
        x[index] === 0 && y[index] === 0 ? "" : `${x[index].toFixed(2)}px ${y[index].toFixed(2)}px`;
    });
  };

  const tick = (time: number) => {
    frame = 0;
    const dt = Math.min(0.05, Math.max(0.001, (time - last) / 1000 || 0.016));
    last = time;

    let nx = 0;
    let ny = 0;
    if (pointer) {
      const box = section.getBoundingClientRect();
      const scale = travelScale(box.width);
      nx = scale * gsap.utils.clamp(-1, 1, (pointer.x - (box.left + box.width / 2)) / (box.width / 2));
      ny = scale * gsap.utils.clamp(-1, 1, (pointer.y - (box.top + box.height / 2)) / (box.height / 2));
    }
    const k = 1 - Math.exp(-dt / FOLLOW);
    let moving = false;
    tiers.forEach((travel, index) => {
      const targetX = nx * travel;
      const targetY = ny * travel;
      x[index] += (targetX - x[index]) * k;
      y[index] += (targetY - y[index]) * k;
      if (Math.abs(targetX - x[index]) < SETTLED && Math.abs(targetY - y[index]) < SETTLED) {
        x[index] = targetX;
        y[index] = targetY;
      } else {
        moving = true;
      }
    });
    write();
    if (moving) frame = requestAnimationFrame(tick);
  };

  const schedule = () => {
    if (frame) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    pointer = overlay && !overlay.hidden ? null : { x: event.clientX, y: event.clientY };
    schedule();
  };
  const onLeave = () => {
    pointer = null;
    schedule();
  };

  const bind = () => {
    if (bound) return;
    bound = true;
    section.addEventListener("pointermove", onMove, { passive: true });
    section.addEventListener("pointerleave", onLeave);
    slots.forEach((slot) => (slot.style.willChange = "translate"));
  };
  const unbind = () => {
    if (!bound) return;
    bound = false;
    section.removeEventListener("pointermove", onMove);
    section.removeEventListener("pointerleave", onLeave);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pointer = null;
    x.fill(0);
    y.fill(0);
    slots.forEach((slot) => {
      slot.style.translate = "";
      slot.style.willChange = "";
    });
  };

  observer = new IntersectionObserver((entries) => {
    const onScreen = entries[entries.length - 1].isIntersecting;
    if (onScreen) bind();
    else unbind();
  });
  observer.observe(section);

  return () => {
    observer?.disconnect();
    observer = null;
    unbind();
  };
}

export function initGalleryTeaser() {
  if (current && !current.section.isConnected) {
    current.destroy();
    current = null;
  }
  const section = document.querySelector<HTMLElement>("#gallery");
  if (!section || current?.section === section) return;

  const slots = Array.from(section.querySelectorAll<HTMLElement>(".gallery_slot"));
  if (!slots.length) return;

  const reduced = window.matchMedia(REDUCED);
  const fine = window.matchMedia(FINE);
  let stopParallax: (() => void) | null = null;

  const syncParallax = () => {
    const enabled = fine.matches && !reduced.matches;
    if (enabled && !stopParallax) stopParallax = setupParallax(section, slots);
    else if (!enabled && stopParallax) {
      stopParallax();
      stopParallax = null;
    }
  };

  const stopReveal = setupReveal(section, slots);
  syncParallax();
  fine.addEventListener("change", syncParallax);
  reduced.addEventListener("change", syncParallax);

  current = {
    section,
    destroy: () => {
      fine.removeEventListener("change", syncParallax);
      reduced.removeEventListener("change", syncParallax);
      stopParallax?.();
      stopParallax = null;
      stopReveal();
    },
  };
}
