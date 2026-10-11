import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { gsap, ScrollTrigger } from "@/scripts/scroll.ts";

gsap.registerPlugin(ScrollTrigger, DrawSVGPlugin);

const timelines = new WeakMap<Element, gsap.core.Timeline>();
let media: gsap.MatchMedia | null = null;
let initialized = false;

function killTimeline(wrap: Element) {
  const timeline = timelines.get(wrap);
  if (!timeline) return;

  timeline.scrollTrigger?.kill();
  timeline.kill();
  timelines.delete(wrap);
}

function cleanup() {
  media?.revert();
  media = null;
  initialized = false;
}

export function initDrawPathOnScroll() {
  if (initialized) return;
  initialized = true;

  const wrappers = document.querySelectorAll<HTMLElement>(
    "[data-draw-scroll-wrap]",
  );
  if (!wrappers.length) {
    initialized = false;
    return;
  }

  media = gsap.matchMedia();
  media.add(
    {
      isDesktop: "(min-width: 768px)",
      isMobile: "(max-width: 767px)",
      reduceMotion: "(prefers-reduced-motion: reduce)",
    },
    (context) => {
      const conditions = (context.conditions || {}) as Record<string, boolean>;
      const { isDesktop, isMobile, reduceMotion } = conditions;

      if (reduceMotion) return;

      wrappers.forEach((wrap) => {
        killTimeline(wrap);

        const desktopSVG = wrap.querySelector<SVGElement>(
          "[data-draw-scroll-desktop]",
        );
        const mobileSVG = wrap.querySelector<SVGElement>(
          "[data-draw-scroll-mobile]",
        );
        const svgToUse = isMobile && mobileSVG ? mobileSVG : desktopSVG;
        if (!svgToUse || (!isDesktop && !isMobile)) return;

        const path = svgToUse.querySelector<SVGPathElement>(
          "[data-draw-scroll-path]",
        );
        if (!path) return;

        const timeline = gsap.timeline({
          defaults: { ease: "linear" },
          scrollTrigger: {
            trigger: wrap,
            start: "clamp(top center)",
            end: "clamp(bottom center)",
            scrub: true,
            invalidateOnRefresh: true,
          },
        });

        timeline.fromTo(path, { drawSVG: 0 }, { drawSVG: "100%", duration: 1 });
        timelines.set(wrap, timeline);
      });

      ScrollTrigger.refresh();

      return () => {
        wrappers.forEach(killTimeline);
      };
    },
  );

  document.addEventListener("astro:before-swap", cleanup, { once: true });
}
