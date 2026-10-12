import { gsap, ScrollTrigger } from "@/scripts/scroll.ts";

gsap.registerPlugin(ScrollTrigger);

let initialized = false;
let cleanups: (() => void)[] = [];

function cleanup() {
  cleanups.forEach((dispose) => dispose());
  cleanups = [];
  initialized = false;
}

export function initTabSystem() {
  if (initialized) return;
  const wrappers = [...document.querySelectorAll<HTMLElement>('[data-tabs="wrapper"]')];
  if (!wrappers.length) return;
  initialized = true;

  wrappers.forEach((wrapper) => {
    const tabs = [...wrapper.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const rows = [...wrapper.querySelectorAll<HTMLElement>('[data-tabs="content-item"]')];
    const panels = [...wrapper.querySelectorAll<HTMLElement>('[data-tabs="visual-item"]')];
    const progress = rows.map((row) => row.querySelector<HTMLElement>('[data-tabs="item-progress"]'));
    const tablist = wrapper.querySelector<HTMLElement>('[role="tablist"]');
    if (!tablist || tabs.length !== rows.length || panels.length !== tabs.length) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let activeIndex = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
    let isAnimating = false;
    let inView = false;
    let interactionPaused = false;
    let progressTween: gsap.core.Tween | null = null;
    let switchTween: gsap.core.Timeline | null = null;

    const setActive = (index: number, keepPanels = false) => {
      activeIndex = index;
      tabs.forEach((tab, itemIndex) => {
        const active = itemIndex === index;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
        rows[itemIndex].classList.toggle("is-active", active);
        panels[itemIndex].classList.toggle("is-active", active);
        panels[itemIndex].hidden = keepPanels ? false : !active;
      });
    };

    const pauseProgress = () => progressTween?.pause();
    const playProgress = () => {
      if (!reducedMotion && inView && !interactionPaused) progressTween?.resume();
    };

    const startProgress = () => {
      progressTween?.kill();
      progress.forEach((bar) => bar && gsap.set(bar, { scaleX: 0, transformOrigin: "left" }));
      if (reducedMotion) return;
      const bar = progress[activeIndex];
      if (!bar) return;
      progressTween = gsap.to(bar, {
        scaleX: 1,
        duration: Number(wrapper.dataset.tabsAutoplayDuration || 5000) / 1000,
        ease: "power1.inOut",
        paused: !inView || interactionPaused,
        onComplete: () => switchTab((activeIndex + 1) % tabs.length),
      });
    };

    const switchTab = (index: number, userInitiated = false) => {
      if (index === activeIndex) return;
      if (isAnimating) {
        if (!userInitiated) return;
        switchTween?.progress(1);
        switchTween?.kill();
        isAnimating = false;
      }
      isAnimating = true;
      progressTween?.kill();
      const outgoing = panels[activeIndex];
      const incoming = panels[index];
      const outgoingBar = progress[activeIndex];
      const nextBar = progress[index];
      outgoing.hidden = false;
      incoming.hidden = false;
      setActive(index, true);
      if (reducedMotion) {
        outgoing.hidden = true;
        isAnimating = false;
        startProgress();
        return;
      }
      switchTween?.kill();
      switchTween = gsap.timeline({
        defaults: { duration: 0.65, ease: "power3" },
        onComplete: () => { outgoing.hidden = true; isAnimating = false; startProgress(); },
      });
      switchTween
        .to(outgoingBar, { scaleX: 0, transformOrigin: "right", duration: 0.3 }, 0)
        .to(outgoing, { autoAlpha: 0, xPercent: 3 }, 0)
        .fromTo(incoming, { autoAlpha: 0, xPercent: 3 }, { autoAlpha: 1, xPercent: 0 }, 0.3)
        .set(nextBar, { scaleX: 0, transformOrigin: "left" }, 0);
    };

    const onRowClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("a")) return;
      switchTab(rows.indexOf(event.currentTarget as HTMLElement), true);
    };
    const onKeydown = (event: KeyboardEvent) => {
      const current = tabs.indexOf(event.target as HTMLButtonElement);
      if (current < 0) return;
      let next = current;
      if (["ArrowRight", "ArrowDown"].includes(event.key)) next = (current + 1) % tabs.length;
      if (["ArrowLeft", "ArrowUp"].includes(event.key)) next = (current - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next === current) return;
      event.preventDefault();
      tabs[next].focus();
      switchTab(next, true);
    };
    const setInteractionPaused = (paused: boolean) => { interactionPaused = paused; paused ? pauseProgress() : playProgress(); };
    const onMouseEnter = () => setInteractionPaused(true);
    const onMouseLeave = () => setInteractionPaused(false);
    const onFocusIn = () => setInteractionPaused(true);
    const onFocusOut = (event: FocusEvent) => { if (!tablist.contains(event.relatedTarget as Node)) setInteractionPaused(false); };
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; inView ? playProgress() : pauseProgress(); }, { threshold: 0.2 });

    rows.forEach((row) => row.addEventListener("click", onRowClick));
    tablist.addEventListener("keydown", onKeydown);
    tablist.addEventListener("mouseenter", onMouseEnter);
    tablist.addEventListener("mouseleave", onMouseLeave);
    tablist.addEventListener("focusin", onFocusIn);
    tablist.addEventListener("focusout", onFocusOut);
    observer.observe(wrapper);
    setActive(activeIndex < 0 ? 0 : activeIndex);
    startProgress();

    cleanups.push(() => {
      observer.disconnect();
      progressTween?.kill();
      switchTween?.kill();
      rows.forEach((row) => row.removeEventListener("click", onRowClick));
      tablist.removeEventListener("keydown", onKeydown);
      tablist.removeEventListener("mouseenter", onMouseEnter);
      tablist.removeEventListener("mouseleave", onMouseLeave);
      tablist.removeEventListener("focusin", onFocusIn);
      tablist.removeEventListener("focusout", onFocusOut);
    });
  });

  document.addEventListener("astro:before-swap", cleanup, { once: true });
}
