import { gsap } from "@/scripts/scroll.ts";

export function initFadeIn() {
  const sections = Array.from(
    document.querySelectorAll<HTMLElement>("[data-fade-in]"),
  ).filter((section) => section.dataset.fadeInInitialized !== "true");

  if (
    !sections.length ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return;

  const mm = gsap.matchMedia();
  mm.add("(prefers-reduced-motion: no-preference)", () => {
    const contexts: gsap.Context[] = [];

    sections.forEach((section) => {
      section.dataset.fadeInInitialized = "true";
      const items = [
        ...(section.hasAttribute("data-fade-in-item") ? [section] : []),
        ...section.querySelectorAll<HTMLElement>("[data-fade-in-item]"),
      ];
      if (!items.length) return;

      const context = gsap.context(() => {
        gsap.set(items, { opacity: 0, y: 24 });
        const reveal = gsap.to(items, {
          opacity: 1,
          y: 0,
          duration: 0.8,
          ease: "power3.out",
          stagger: 0.08,
          scrollTrigger: {
            trigger: section,
            start: "top 85%",
            once: true,
          },
        });
        const finish = () => {
          reveal.scrollTrigger?.kill();
          reveal.progress(1);
        };
        section.addEventListener("focusin", finish, { once: true });
        return () => section.removeEventListener("focusin", finish);
      }, section);
      contexts.push(context);
    });

    return () => contexts.forEach((context) => context.revert());
  });
}
