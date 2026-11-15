import { gsap } from "gsap";
import { Draggable } from "gsap/Draggable";
import { InertiaPlugin } from "gsap/InertiaPlugin";

gsap.registerPlugin(Draggable, InertiaPlugin);

type SliderState = {
  draggable: Draggable;
  abort: AbortController;
  tween?: gsap.core.Tween;
};

const states = new WeakMap<HTMLElement, SliderState>();

function initBasicGSAPSlider() {
  document
    .querySelectorAll<HTMLElement>("[data-gsap-slider-init]")
    .forEach((root) => {
      const previous = states.get(root);
      previous?.tween?.kill();
      previous?.draggable.kill();
      previous?.abort.abort();

      const collection = root.querySelector<HTMLElement>(
        "[data-gsap-slider-collection]",
      );
      const track = root.querySelector<HTMLElement>("[data-gsap-slider-list]");
      const items = Array.from(
        root.querySelectorAll<HTMLElement>("[data-gsap-slider-item]"),
      );
      const controls = Array.from(
        root.querySelectorAll<HTMLButtonElement>("[data-gsap-slider-control]"),
      );
      const counter = root.querySelector<HTMLElement>(
        "[data-gsap-slider-counter]",
      );
      if (!collection || !track || !items.length) return;

      const styles = getComputedStyle(root);
      const statusVar = styles.getPropertyValue("--slider-status").trim();
      const rect = items[0].getBoundingClientRect();
      const marginRight = parseFloat(getComputedStyle(items[0]).marginRight);
      const slideW = rect.width + marginRight;
      const spv = Math.max(
        1,
        Math.min(collection.clientWidth / slideW, items.length),
      );
      const sliderEnabled = statusVar === "on" && spv < items.length;
      root.setAttribute(
        "data-gsap-slider-status",
        sliderEnabled ? "active" : "not-active",
      );
      track.onmouseenter = null;
      track.onmouseleave = null;
      if (!sliderEnabled) {
        gsap.set(track, { clearProps: "transform" });
        root.removeAttribute("role");
        root.removeAttribute("aria-roledescription");
        collection.removeAttribute("role");
        collection.removeAttribute("aria-roledescription");
        collection.removeAttribute("aria-label");
        items.forEach((slide) => {
          slide.removeAttribute("role");
          slide.removeAttribute("aria-roledescription");
          slide.removeAttribute("aria-label");
          slide.removeAttribute("aria-hidden");
          slide.removeAttribute("aria-selected");
          slide.removeAttribute("tabindex");
          slide.removeAttribute("data-gsap-slider-item-status");
        });
        controls.forEach((button) => {
          button.removeAttribute("role");
          button.disabled = false;
          button.removeAttribute("aria-disabled");
          button.removeAttribute("data-gsap-slider-control-status");
        });
        track.removeAttribute("data-gsap-slider-list-status");
        return;
      }

      root.setAttribute("role", "region");
      root.setAttribute("aria-roledescription", "carousel");
      collection.setAttribute("role", "group");
      collection.setAttribute("aria-roledescription", "Slides List");
      collection.setAttribute("aria-label", "Slides");
      items.forEach((slide, index) => {
        slide.setAttribute("role", "group");
        slide.setAttribute("aria-roledescription", "Slide");
        slide.setAttribute(
          "aria-label",
          `Slide ${index + 1} of ${items.length}`,
        );
        slide.setAttribute("aria-hidden", "true");
        slide.setAttribute("aria-selected", "false");
        slide.setAttribute("tabindex", "-1");
      });

      const abort = new AbortController();
      controls.forEach((button) => {
        button.setAttribute("role", "button");
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      });

      track.onmouseenter = () =>
        track.setAttribute("data-gsap-slider-list-status", "grab");
      track.onmouseleave = () =>
        track.removeAttribute("data-gsap-slider-list-status");

      const vw = collection.clientWidth;
      const tw = track.scrollWidth;
      const maxScroll = Math.max(tw - vw, 0);
      const minX = -maxScroll;
      const maxX = 0;
      const maxIndex = maxScroll / slideW;
      const full = Math.floor(maxIndex);
      const snapPoints: number[] = [];
      for (let index = 0; index <= full; index += 1)
        snapPoints.push(-index * slideW);
      if (full < maxIndex) snapPoints.push(-maxIndex * slideW);

      let activeIndex = 0;
      let announcedIndex = -1;
      let collectionRect = collection.getBoundingClientRect();
      const setX = gsap.quickSetter(track, "x", "px");
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      function updateStatus(x: number) {
        if (x > maxX || x < minX) return;
        const calcX = Math.max(minX, Math.min(maxX, x));
        let closest = snapPoints[0];
        snapPoints.forEach((point) => {
          if (Math.abs(point - calcX) < Math.abs(closest - calcX))
            closest = point;
        });
        activeIndex = snapPoints.indexOf(closest);
        items.forEach((slide, index) => {
          const slideRect = slide.getBoundingClientRect();
          const leftEdge = slideRect.left - collectionRect.left;
          const inView =
            leftEdge + slideRect.width / 2 > 0 &&
            leftEdge + slideRect.width / 2 < collectionRect.width;
          const status =
            index === activeIndex
              ? "active"
              : inView
                ? "inview"
                : "not-active";
          slide.setAttribute("data-gsap-slider-item-status", status);
          slide.setAttribute(
            "aria-selected",
            index === activeIndex ? "true" : "false",
          );
          slide.setAttribute("aria-hidden", inView ? "false" : "true");
          slide.setAttribute("tabindex", index === activeIndex ? "0" : "-1");
        });
        controls.forEach((button) => {
          const canMove =
            button.dataset.gsapSliderControl === "prev"
              ? activeIndex > 0
              : activeIndex < snapPoints.length - 1;
          button.disabled = !canMove;
          button.setAttribute("aria-disabled", canMove ? "false" : "true");
          button.setAttribute(
            "data-gsap-slider-control-status",
            canMove ? "active" : "not-active",
          );
        });
        if (counter && activeIndex !== announcedIndex) {
          announcedIndex = activeIndex;
          const text = `${String(activeIndex + 1).padStart(2, "0")} / ${String(snapPoints.length).padStart(2, "0")} `;
          if (counter.firstChild?.nodeType === Node.TEXT_NODE)
            counter.firstChild.textContent = text;
          else counter.textContent = text;
        }
      }

      controls.forEach((button) => {
        button.addEventListener(
          "click",
          () => {
            if (button.disabled) return;
            const delta =
              button.dataset.gsapSliderControl === "next" ? 1 : -1;
            const target = activeIndex + delta;
            const tween = gsap.to(track, {
              duration: reducedMotion ? 0 : 0.4,
              x: snapPoints[target],
              onUpdate: () =>
                updateStatus(gsap.getProperty(track, "x") as number),
            });
            states.set(root, { draggable, abort, tween });
          },
          { signal: abort.signal },
        );
      });

      const draggable = Draggable.create(track, {
        type: "x",
        inertia: !reducedMotion,
        bounds: { minX, maxX },
        throwResistance: 2000,
        dragResistance: 0.05,
        maxDuration: 0.6,
        minDuration: 0.2,
        edgeResistance: 0.75,
        snap: { x: snapPoints },
        onPress() {
          track.setAttribute("data-gsap-slider-list-status", "grabbing");
          collectionRect = collection.getBoundingClientRect();
        },
        onDrag() {
          setX(this.x);
          updateStatus(this.x);
        },
        onThrowUpdate() {
          setX(this.x);
          updateStatus(this.x);
        },
        onThrowComplete() {
          setX(this.endX);
          updateStatus(this.endX);
          track.setAttribute("data-gsap-slider-list-status", "grab");
        },
        onRelease() {
          setX(this.x);
          updateStatus(this.x);
          track.setAttribute("data-gsap-slider-list-status", "grab");
        },
      })[0];

      states.set(root, { draggable, abort });
      setX(0);
      updateStatus(0);
    });
}

function debounceOnWidthChange(fn: () => void, ms: number) {
  let last = window.innerWidth;
  let timer: number | undefined;
  return () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (window.innerWidth !== last) {
        last = window.innerWidth;
        fn();
      }
    }, ms);
  };
}

initBasicGSAPSlider();
window.addEventListener(
  "resize",
  debounceOnWidthChange(initBasicGSAPSlider, 200),
);
document.addEventListener("astro:page-load", initBasicGSAPSlider);
