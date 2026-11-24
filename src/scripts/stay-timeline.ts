import { gsap, ScrollTrigger } from "@/scripts/scroll.ts";

const MOBILE_TIMELINE = "(max-width: 61.999rem) and (prefers-reduced-motion: no-preference)";
const REACH_POINT = "top 65%";

let media: gsap.MatchMedia | null = null;

function cleanup() {
  media?.revert();
  media = null;
}

export function initStayTimeline() {
  if (media) return;

  const steps = gsap.utils.toArray<HTMLElement>("#stay .stay_step");
  if (steps.length < 2) return;

  media = gsap.matchMedia();
  media.add(MOBILE_TIMELINE, () => {
    steps.forEach((step, index) => {
      const line = step.querySelector<HTMLElement>(".stay_step-line");
      const next = steps[index + 1];

      ScrollTrigger.create({
        trigger: step,
        start: REACH_POINT,
        end: "max",
        toggleClass: { targets: step, className: "is-reached" },
      });

      if (!line || !next) return;
      gsap.fromTo(
        line,
        { scaleY: 0 },
        {
          scaleY: 1,
          ease: "none",
          scrollTrigger: {
            trigger: step,
            endTrigger: next,
            start: REACH_POINT,
            end: REACH_POINT,
            scrub: true,
          },
        },
      );
    });

    return () => steps.forEach((step) => step.classList.remove("is-reached"));
  });

  document.addEventListener("astro:before-swap", cleanup, { once: true });
}
