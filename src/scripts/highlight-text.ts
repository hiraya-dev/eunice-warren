import { SplitText } from "gsap/SplitText";
import { gsap, ScrollTrigger } from "@/scripts/scroll.ts";

gsap.registerPlugin(ScrollTrigger, SplitText);

const splits = new Set<SplitText>();
let media: gsap.MatchMedia | null = null;
let initialized = false;

function cleanup() {
  media?.revert();
  media = null;
  revertSplits();
  initialized = false;
}

function revertSplits() {
  splits.forEach((split) => split.revert());
  splits.clear();
}

export function initHighlightText() {
  if (initialized) return;
  initialized = true;

  const targets = document.querySelectorAll<HTMLElement>("[data-highlight-text]");
  if (!targets.length) {
    initialized = false;
    return;
  }

  media = gsap.matchMedia();
  // matchMedia only runs the callback while at least one condition matches, so pair
  // reduceMotion with its opposite to cover every visitor.
  media.add({ motion: "(prefers-reduced-motion: no-preference)", reduceMotion: "(prefers-reduced-motion: reduce)" }, (context) => {
    const conditions = (context.conditions || {}) as Record<string, boolean>;
    if (conditions.reduceMotion) return;

    targets.forEach((heading) => {
      const scrollStart = heading.getAttribute("data-highlight-scroll-start") || "top 90%";
      const scrollEnd = heading.getAttribute("data-highlight-scroll-end") || "center 40%";
      const fadedValue = heading.getAttribute("data-highlight-fade") || 0.2;
      const staggerValue = parseFloat(heading.getAttribute("data-highlight-stagger") || "0.1");

      new SplitText(heading, {
        type: "words, chars",
        autoSplit: true,
        onSplit(self) {
          splits.add(self);
          const ctx = gsap.context(() => {
            const timeline = gsap.timeline({
              scrollTrigger: {
                scrub: true,
                trigger: heading,
                start: scrollStart,
                end: scrollEnd,
              },
            });
            timeline.from(self.chars, {
              autoAlpha: fadedValue,
              stagger: staggerValue,
              ease: "linear",
            });
          });
          return ctx;
        },
      });
    });

    return revertSplits;
  });

  document.addEventListener("astro:before-swap", cleanup, { once: true });
}
