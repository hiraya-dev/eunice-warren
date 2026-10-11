import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export { gsap, ScrollTrigger };

export function initGlobalParallax() {
  if (document.documentElement.dataset.globalParallaxInitialized === "true")
    return;
  document.documentElement.dataset.globalParallaxInitialized = "true";

  const mm = gsap.matchMedia();

  mm.add(
    {
      isMobile: "(max-width: 479px)",
      isMobileLandscape: "(max-width: 767px)",
      isTablet: "(max-width: 991px)",
      isDesktop: "(min-width: 992px)",
      reduceMotion: "(prefers-reduced-motion: reduce)",
    },
    (context) => {
      const conditions = (context.conditions || {}) as Record<string, boolean>;
      const { isMobile, isMobileLandscape, isTablet, reduceMotion } =
        conditions;

      if (reduceMotion) return;

      const ctx = gsap.context(() => {
        document
          .querySelectorAll('[data-parallax="trigger"]')
          .forEach((trigger) => {
            const disable = trigger.getAttribute("data-parallax-disable");

            if (
              (disable === "mobile" && isMobile) ||
              (disable === "mobileLandscape" && isMobileLandscape) ||
              (disable === "tablet" && isTablet)
            )
              return;

            const target =
              trigger.querySelector('[data-parallax="target"]') || trigger;
            const direction =
              trigger.getAttribute("data-parallax-direction") || "vertical";
            const prop = direction === "horizontal" ? "xPercent" : "yPercent";

            const scrubAttr = trigger.getAttribute("data-parallax-scrub");
            const startAttr = trigger.getAttribute("data-parallax-start");
            const endAttr = trigger.getAttribute("data-parallax-end");

            const scrub = scrubAttr !== null ? parseFloat(scrubAttr) : true;
            const startVal = startAttr !== null ? parseFloat(startAttr) : 20;
            const endVal = endAttr !== null ? parseFloat(endAttr) : -20;

            const scrollStart = `clamp(${trigger.getAttribute("data-parallax-scroll-start") || "top bottom"})`;
            const scrollEnd = `clamp(${trigger.getAttribute("data-parallax-scroll-end") || "bottom top"})`;

            gsap.fromTo(
              target,
              {
                [prop]: startVal,
              },
              {
                [prop]: endVal,
                ease: "none",
                scrollTrigger: {
                  trigger,
                  start: scrollStart,
                  end: scrollEnd,
                  scrub,
                },
              },
            );
          });
      });

      return () => ctx.revert();
    },
  );
}

export let lenis: Lenis | null = null;

let initialized = false;

export const initScroll = () => {
  if (initialized) return;
  initialized = true;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  lenis = new Lenis({ anchors: true });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => {
    lenis?.raf(time * 1000);
  });
  gsap.ticker.lagSmoothing(0);
};
