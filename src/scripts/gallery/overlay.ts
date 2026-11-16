import { lenis } from "@/scripts/scroll.ts";

type GalleryPhoto = {
  index: number;
  name: string;
  width: number;
  height: number;
  orientation: "portrait" | "landscape";
  fine: string;
  coarse: string;
  full: string;
  original: string;
};

type GalleryCanvas = {
  pause: () => void;
  resume: () => void;
  setLightboxOpen: (open: boolean) => void;
  destroy: () => void;
};

type GallerySourceRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const visible = (element: HTMLElement) => {
  const styles = getComputedStyle(element);
  return (
    Boolean(element.getClientRects().length) &&
    styles.visibility !== "hidden" &&
    styles.display !== "none"
  );
};

const readManifest = (root: HTMLElement): GalleryPhoto[] => {
  const source = root.querySelector<HTMLScriptElement>(
    "[data-gallery-manifest]",
  );
  if (!source?.textContent) return [];
  try {
    return JSON.parse(source.textContent) as GalleryPhoto[];
  } catch {
    return [];
  }
};

const createFallbackStamp = (
  photo: GalleryPhoto,
  total: number,
  coarse: boolean,
) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "stamp_wrap gallery_grid-item";
  button.setAttribute(
    "aria-label",
    `Open photo ${photo.index + 1} of ${total}`,
  );
  button.dataset.galleryPhoto = String(photo.index);
  button.style.appearance = "none";
  button.style.border = "0";
  button.style.padding = "0";
  button.style.background = "transparent";

  const paper = document.createElement("span");
  paper.className = "stamp_paper light-200";
  const art = document.createElement("span");
  art.className = "stamp_art";
  const image = document.createElement("img");
  image.src = coarse ? photo.coarse : photo.fine;
  image.alt = `Photo ${photo.index + 1}`;
  image.loading = "lazy";
  image.decoding = "async";
  image.width = photo.width;
  image.height = photo.height;
  art.append(image);
  paper.append(art);
  button.append(paper);
  if (photo.orientation === "landscape")
    button.dataset.orientation = "landscape";
  return button;
};

export function initGalleryOverlay() {
  document
    .querySelectorAll<HTMLElement>("[data-gallery-overlay]")
    .forEach((overlay) => {
      if (overlay.dataset.galleryReady === "true") return;
      overlay.dataset.galleryReady = "true";

      const root =
        overlay.closest<HTMLElement>("#gallery") ?? overlay.parentElement;
      const openButton = root?.querySelector<HTMLButtonElement>(
        "[data-gallery-open]",
      );
      const stage = overlay.querySelector<HTMLElement>("[data-gallery-stage]");
      const grid = overlay.querySelector<HTMLElement>("[data-gallery-grid]");
      const list = overlay.querySelector<HTMLElement>("[data-gallery-list]");
      const closeButton = overlay.querySelector<HTMLButtonElement>(
        "[data-gallery-close]",
      );
      const hint = overlay.querySelector<HTMLElement>("[data-gallery-hint]");
      const hoverLabel = overlay.querySelector<HTMLElement>(
        "[data-gallery-hover-label]",
      );
      const lightbox = overlay.querySelector<HTMLElement>(
        "[data-gallery-lightbox]",
      );
      const lightboxStamp = overlay.querySelector<HTMLElement>(
        "[data-gallery-lightbox-stamp]",
      );
      const lightboxImage = overlay.querySelector<HTMLImageElement>(
        "[data-gallery-lightbox-img]",
      );
      const lightboxCount = overlay.querySelector<HTMLElement>(
        "[data-gallery-lightbox-count]",
      );
      const lightboxClose = overlay.querySelector<HTMLButtonElement>(
        "[data-gallery-lightbox-close]",
      );
      const previousButton = overlay.querySelector<HTMLButtonElement>(
        "[data-gallery-prev]",
      );
      const nextButton = overlay.querySelector<HTMLButtonElement>(
        "[data-gallery-next]",
      );
      const saveLink = overlay.querySelector<HTMLAnchorElement>(
        "[data-gallery-save]",
      );
      const scrim = overlay.querySelector<HTMLElement>("[data-gallery-scrim]");
      const photos = readManifest(root ?? overlay);
      if (
        !openButton ||
        !stage ||
        !grid ||
        !list ||
        !closeButton ||
        !lightbox ||
        !lightboxStamp ||
        !lightboxImage ||
        !lightboxCount ||
        !lightboxClose ||
        !previousButton ||
        !nextButton ||
        !saveLink ||
        !scrim
      )
        return;

      let canvas: GalleryCanvas | null = null;
      let fallback = false;
      let currentIndex = 0;
      let fullImageRequest = 0;
      let touchStartX: number | null = null;
      let previousOverflow = "";
      let previousBodyPaddingRight = "";
      let previousBackgroundPosition = "";
      let previousScrollY = 0;
      let lockActive = false;
      let openingToken = 0;
    let sourceRect: GallerySourceRect | null = null;

      const reducedMotion = () =>
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const coarsePointer = () =>
        window.matchMedia("(pointer: coarse)").matches;

      const focusables = () =>
        Array.from(
          overlay.querySelectorAll<HTMLElement>(
            'button, a[href], [tabindex]:not([tabindex="-1"])',
          ),
        ).filter(
          (element) => !element.hasAttribute("disabled") && visible(element),
        );

      const lockScroll = () => {
        if (lockActive) return;
        previousOverflow = document.documentElement.style.overflow;
        previousBodyPaddingRight = document.body.style.paddingRight;
        previousBackgroundPosition =
          document.documentElement.style.backgroundPosition;
        previousScrollY = window.scrollY;
        const scrollbar =
          window.innerWidth - document.documentElement.clientWidth;
        document.documentElement.style.overflow = "hidden";
        document.documentElement.style.setProperty(
          "--scrollbar-compensation",
          `${scrollbar}px`,
        );
        document.body.style.paddingRight = "var(--scrollbar-compensation, 0px)";
        document.documentElement.style.backgroundPosition = `calc(50% - ${scrollbar / 2}px) 50%`;
        lockActive = true;
        lenis?.stop();
      };

      const unlockScroll = () => {
        if (!lockActive) return;
        document.documentElement.style.overflow = previousOverflow;
        document.body.style.paddingRight = previousBodyPaddingRight;
        document.documentElement.style.backgroundPosition =
          previousBackgroundPosition;
        document.documentElement.style.removeProperty(
          "--scrollbar-compensation",
        );
        lenis?.start();
        window.scrollTo(0, previousScrollY);
        lockActive = false;
      };

      const showFallback = () => {
        fallback = true;
        stage.hidden = true;
        grid.hidden = false;
        if (grid.childElementCount) return;
        const coarse = coarsePointer();
        for (const photo of photos) {
          const stamp = createFallbackStamp(photo, photos.length, coarse);
          stamp.addEventListener("click", () => openPhoto(photo.index));
          grid.append(stamp);
        }
      };

      const fillList = () => {
        list.replaceChildren();
        for (const photo of photos) {
          const item = document.createElement("li");
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = `Open photo ${photo.index + 1} of ${photos.length}`;
          button.setAttribute(
            "aria-label",
            `Open photo ${photo.index + 1} of ${photos.length}`,
          );
          button.dataset.galleryPhoto = String(photo.index);
          button.addEventListener("click", () => openPhoto(photo.index));
          item.append(button);
          list.append(item);
        }
      };

      const setHoverLabel = (index: number, x: number, y: number) => {
        if (!hoverLabel || !window.matchMedia("(pointer: fine)").matches)
          return;
        hoverLabel.hidden = false;
        hoverLabel.textContent = `Open · ${String(index + 1).padStart(3, "0")}`;
        // `translate` (not `transform`): the CSS `rotate: -2deg` would otherwise rotate the offset.
        hoverLabel.style.translate = `${x}px ${y}px`;
      };

      const hideHoverLabel = () => {
        if (!hoverLabel) return;
        hoverLabel.hidden = true;
      };

      const setHintFaded = () => {
        if (hint) hint.dataset.faded = "true";
      };

      const setLightboxPhoto = (index: number) => {
        const photo = photos[index];
        if (!photo) return;
        currentIndex = index;
        lightboxStamp.dataset.orientation = photo.orientation;
        lightboxImage.src = coarsePointer() ? photo.coarse : photo.fine;
        lightboxImage.alt = `Photo ${index + 1} of ${photos.length}`;
        lightboxCount.textContent = `${String(index + 1).padStart(3, "0")} / ${String(photos.length).padStart(3, "0")}${coarsePointer() ? " · Swipe for the next one" : ""}`;
        saveLink.href = photo.original;
        saveLink.download = `eunice-warren-${String(index + 1).padStart(3, "0")}.jpg`;
        const requestId = ++fullImageRequest;
        const fullImage = new Image();
        fullImage.onload = () => {
          if (
            requestId === fullImageRequest &&
            currentIndex === index &&
            overlay.dataset.galleryState === "open"
          )
            lightboxImage.src = photo.full;
        };
        fullImage.src = photo.full;
      };

    const animateLightboxStamp = (from: GallerySourceRect | null, opening: boolean) => {
      if (reducedMotion()) return;
      const target = lightboxStamp.getBoundingClientRect();
      const source = from ?? {
        left: target.left + target.width * 0.1,
        top: target.top + target.height * 0.1,
        width: target.width * 0.8,
        height: target.height * 0.8,
      };
      const dx = source.left + source.width / 2 - (target.left + target.width / 2);
      const dy = source.top + source.height / 2 - (target.top + target.height / 2);
      const sx = source.width / target.width;
      const sy = source.height / target.height;
      const fromTransform = `translate(${opening ? dx : 0}px, ${opening ? dy : 0}px) scale(${opening ? sx : 1}, ${opening ? sy : 1})`;
      const toTransform = `translate(${opening ? 0 : dx}px, ${opening ? 0 : dy}px) scale(${opening ? 1 : sx}, ${opening ? 1 : sy})`;
      const animation = lightboxStamp.animate(
        [
          { transform: fromTransform, opacity: opening ? 0.65 : 1 },
          { transform: toTransform, opacity: opening ? 1 : 0.65 },
        ],
        { duration: opening ? 680 : 520, easing: opening ? "cubic-bezier(0.16, 1, 0.3, 1)" : "cubic-bezier(0.7, 0, 0.84, 0)", fill: "both" },
      );
      animation.addEventListener("finish", () => animation.cancel(), { once: true });
    };

    const openPhoto = (index: number, from: GallerySourceRect | null = null) => {
        if (!photos[index]) return;
      sourceRect = from;
        setLightboxPhoto(index);
        overlay.dataset.galleryState = "open";
        canvas?.setLightboxOpen(true);
        hideHoverLabel();
      animateLightboxStamp(sourceRect, true);
        lightboxClose.focus({ preventScroll: true });
      };

      const closePhoto = () => {
        if (overlay.dataset.galleryState !== "open") return;
      animateLightboxStamp(sourceRect, false);
        overlay.dataset.galleryState = "canvas";
        canvas?.setLightboxOpen(false);
        const currentButton = list.querySelector<HTMLButtonElement>(
          `[data-gallery-photo=\"${currentIndex}\"]`,
        );
        currentButton?.focus({ preventScroll: true });
      };

      const nextPhoto = (direction: 1 | -1) => {
        if (!photos.length) return;
        setLightboxPhoto(
          (currentIndex + direction + photos.length) % photos.length,
        );
      };

      const closeOverlay = () => {
        if (overlay.dataset.galleryState === "open") {
          closePhoto();
          return;
        }
        openingToken += 1;
        overlay.dataset.galleryState = "closed";
        overlay.hidden = true;
        canvas?.pause();
        hideHoverLabel();
        unlockScroll();
        openButton.focus({ preventScroll: true });
      };

      const bootCanvas = async (token: number) => {
        if (canvas || fallback) {
          canvas?.resume();
          return;
        }
        try {
          const module = await import("./canvas.ts");
          if (
            token !== openingToken ||
            overlay.hidden ||
            overlay.dataset.galleryState !== "canvas"
          )
            return;
          canvas = module.createGalleryCanvas({
            stage,
            photos,
            reducedMotion: reducedMotion(),
            onInteraction: setHintFaded,
            onHover: setHoverLabel,
            onHoverEnd: hideHoverLabel,
            onStampClick: openPhoto,
          });
          if (!canvas) showFallback();
        } catch {
          if (token === openingToken) showFallback();
        }
      };

      const openOverlay = () => {
        if (overlay.dataset.galleryState !== "closed") return;
        openingToken += 1;
        const token = openingToken;
        overlay.hidden = false;
        overlay.dataset.galleryState = "canvas";
        grid.hidden = !fallback;
        stage.hidden = fallback;
        lockScroll();
        closeButton.focus({ preventScroll: true });
        if (canvas) canvas.resume();
        else void bootCanvas(token);
      };

      fillList();
      openButton.addEventListener("click", openOverlay);
      closeButton.addEventListener("click", closeOverlay);
      lightboxClose.addEventListener("click", closePhoto);
      previousButton.addEventListener("click", () => nextPhoto(-1));
      nextButton.addEventListener("click", () => nextPhoto(1));
      scrim.addEventListener("click", closePhoto);
      lightbox.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse") return;
        touchStartX = event.clientX;
      });
      lightbox.addEventListener("pointerup", (event) => {
        if (touchStartX === null) return;
        const delta = event.clientX - touchStartX;
        touchStartX = null;
        if (Math.abs(delta) > 40) nextPhoto(delta < 0 ? 1 : -1);
      });
      document.addEventListener("keydown", (event) => {
        if (overlay.hidden) return;
        if (event.key === "Escape") {
          event.preventDefault();
          if (overlay.dataset.galleryState === "open") closePhoto();
          else closeOverlay();
          return;
        }
        if (
          overlay.dataset.galleryState === "open" &&
          (event.key === "ArrowLeft" || event.key === "ArrowRight")
        ) {
          event.preventDefault();
          nextPhoto(event.key === "ArrowRight" ? 1 : -1);
          return;
        }
        if (event.key !== "Tab") return;
        const items = focusables();
        if (!items.length) return;
        const current = items.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey
          ? current <= 0
            ? items.length - 1
            : current - 1
          : current === items.length - 1
            ? 0
            : current + 1;
        event.preventDefault();
        items[next].focus({ preventScroll: true });
      });
    });
}
