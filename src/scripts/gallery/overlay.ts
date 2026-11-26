import { lenis } from "@/scripts/scroll.ts";
import {
  drawPopupPolaroid,
  loadGalleryPhoto,
} from "@/scripts/gallery/stamp-texture.ts";

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

type GallerySourceRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type GalleryCanvas = {
  pause: () => void;
  resume: () => void;
  setLightboxOpen: (open: boolean, index?: number) => GallerySourceRect | null;
  destroy: () => void;
};

const visible = (element: HTMLElement) => {
  const styles = getComputedStyle(element);
  return (
    Boolean(element.getClientRects().length) &&
    styles.visibility !== "hidden" &&
    styles.display !== "none"
  );
};

const elementRect = (element: HTMLElement | null) => {
  if (!element || !visible(element)) return null;
  if (
    element.closest("[data-gallery-list]") &&
    !element.matches(":focus-visible")
  )
    return null;
  const rect = element.getBoundingClientRect();
  if (
    rect.width <= 2 ||
    rect.height <= 2 ||
    rect.right < 0 ||
    rect.bottom < 0 ||
    rect.left > window.innerWidth ||
    rect.top > window.innerHeight
  )
    return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
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

const createFallbackPolaroid = (
  photo: GalleryPhoto,
  total: number,
  coarse: boolean,
) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "gallery_polaroid gallery_grid-item";
  button.setAttribute(
    "aria-label",
    `Open photo ${photo.index + 1} of ${total}`,
  );
  button.dataset.galleryPhoto = String(photo.index);
  button.style.appearance = "none";
  button.style.border = "0";
  button.style.padding = "0";

  const photoFrame = document.createElement("span");
  photoFrame.className = "gallery_polaroid-photo";
  const image = document.createElement("img");
  image.src = coarse ? photo.coarse : photo.fine;
  image.alt = `Photo ${photo.index + 1}`;
  image.loading = "lazy";
  image.decoding = "async";
  image.width = photo.width;
  image.height = photo.height;
  photoFrame.append(image);
  button.append(photoFrame);
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
      const lightboxCanvas = overlay.querySelector<HTMLCanvasElement>(
        "[data-gallery-lightbox-canvas]",
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
        !lightboxCanvas ||
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
      let currentImage: HTMLImageElement | null = null;
      let fullImageRequest = 0;
      let lightboxToken = 0;
      let lightboxBusy = false;
      let frameAnimation: Animation | null = null;
      let touchStartX: number | null = null;
      let previousOverflow = "";
      let previousBodyPaddingRight = "";
      let previousBackgroundPosition = "";
      let previousScrollY = 0;
      let lockActive = false;
      let openingToken = 0;
      let overlayListenersBound = false;
      let galleryPrefetchStarted = false;
      let galleryPrefetchObserver: IntersectionObserver | null = null;
      const PREFETCH_BATCH_SIZE = 5;

      const reducedMotion = () =>
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const coarsePointer = () =>
        window.matchMedia("(pointer: coarse)").matches;

      const focusables = () => {
        const scope =
          overlay.dataset.galleryState === "open" ? lightbox : overlay;
        return Array.from(
          scope.querySelectorAll<HTMLElement>(
            'button, a[href], [tabindex]:not([tabindex="-1"])',
          ),
        ).filter(
          (element) => !element.hasAttribute("disabled") && visible(element),
        );
      };

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

      const popupSize = (photo: GalleryPhoto) => {
        const maxWidth = Math.max(
          30,
          Math.min(window.innerWidth * 0.92, window.innerWidth - 32),
        );
        const frame = lightboxStamp.parentElement;
        const frameHeight =
          (frame && Number.parseFloat(getComputedStyle(frame).maxHeight)) ||
          Infinity;
        const maxHeight = Math.max(
          30,
          Math.min(window.innerHeight * 0.74, frameHeight),
        );
        const outerHeightPerWidth =
          0.88 * (photo.height / photo.width) + 0.26;
        const width = Math.min(maxWidth, maxHeight / outerHeightPerWidth);
        return { width, height: width * outerHeightPerWidth };
      };

      const popupFont = (width: number) => {
        const family =
          getComputedStyle(document.documentElement)
            .getPropertyValue("--font-delicious-handrawn")
            .trim() || "cursive";
        const fontSize = width * 0.075;
        const spec = `400 ${fontSize}px ${family}`;
        return {
          family,
          spec,
          ready: document.fonts.check(spec),
        };
      };

      const redrawPopupText = async (index: number, token: number) => {
        const photo = photos[index];
        const image = currentImage;
        if (!photo || !image) return;
        const size = popupSize(photo);
        const font = popupFont(size.width);
        let fontFamily = font.family;
        try {
          await document.fonts.load(font.spec);
        } catch {
          fontFamily = "cursive";
        }
        if (
          token !== lightboxToken ||
          currentIndex !== index ||
          !currentImage ||
          overlay.dataset.galleryState !== "open"
        )
          return;
        drawPopupPolaroid(
          lightboxCanvas,
          currentImage,
          size.width,
          size.height,
          Math.min(window.devicePixelRatio || 1, 2),
          { index, total: photos.length, fontFamily },
        );
      };

      const drawLightbox = (index: number, image: HTMLImageElement) => {
        const photo = photos[index];
        if (!photo) return;
        const size = popupSize(photo);
        const font = popupFont(size.width);
        lightboxStamp.style.width = `${size.width}px`;
        lightboxStamp.style.height = `${size.height}px`;
        drawPopupPolaroid(
          lightboxCanvas,
          image,
          size.width,
          size.height,
          Math.min(window.devicePixelRatio || 1, 2),
          font.ready
            ? { index, total: photos.length, fontFamily: font.family }
            : undefined,
        );
        lightboxCanvas.setAttribute(
          "aria-label",
          `Photo ${index + 1} of ${photos.length}`,
        );
        if (!font.ready) void redrawPopupText(index, lightboxToken);
      };

      const setPhotoMetadata = (index: number) => {
        const photo = photos[index];
        if (!photo) return;
        currentIndex = index;
        const coarse = coarsePointer();
        lightboxCount.hidden = !coarse;
        lightboxCount.textContent = coarse ? "Swipe for the next one" : "";
        saveLink.href = photo.original;
        saveLink.download = `eunice-warren-${String(index + 1).padStart(3, "0")}.jpg`;
      };

      const requestFullImage = (index: number, token: number) => {
        const photo = photos[index];
        if (!photo) return;
        const requestId = ++fullImageRequest;
        void loadGalleryPhoto(photo.full)
          .then((image) => {
            if (
              requestId !== fullImageRequest ||
              token !== lightboxToken ||
              currentIndex !== index ||
              overlay.dataset.galleryState !== "open"
            )
              return;
            currentImage = image;
            drawLightbox(index, image);
          })
          .catch(() => {
          });
      };

      const preparePhoto = async (index: number, token: number) => {
        const photo = photos[index];
        if (!photo) return false;
        try {
          const image = await loadGalleryPhoto(
            coarsePointer() ? photo.coarse : photo.fine,
          );
          if (token !== lightboxToken) return false;
          currentImage = image;
          setPhotoMetadata(index);
          drawLightbox(index, image);
          return true;
        } catch {
          return false;
        }
      };

      const animateStamp = async (
        source: GallerySourceRect | null,
        opening: boolean,
      ) => {
        frameAnimation?.cancel();
        frameAnimation = null;
        if (reducedMotion()) return;
        const target = lightboxStamp.getBoundingClientRect();
        const fallbackSource = {
          left: target.left + target.width * 0.04,
          top: target.top + target.height * 0.04,
          width: target.width * 0.92,
          height: target.height * 0.92,
        };
        const from = source ?? fallbackSource;
        const deltaX =
          from.left + from.width / 2 - (target.left + target.width / 2);
        const deltaY =
          from.top + from.height / 2 - (target.top + target.height / 2);
        const scaleX = from.width / target.width;
        const scaleY = from.height / target.height;
        const flipped = `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`;
        const animation = lightboxStamp.animate(
          opening
            ? [
                { transform: flipped, opacity: source ? 1 : 0 },
                { transform: "none", opacity: 1 },
              ]
            : source
              ? [
                  { transform: "none", opacity: 1 },
                  { transform: flipped, opacity: 1 },
                ]
              : [
                  { transform: "none", opacity: 1 },
                  { transform: "scale(0.92)", opacity: 0 },
                ],
          {
            duration: opening ? 680 : 520,
            easing: opening
              ? "cubic-bezier(0.16, 1, 0.3, 1)"
              : "cubic-bezier(0.76, 0, 0.24, 1)",
            fill: "both",
          },
        );
        frameAnimation = animation;
        try {
          await animation.finished;
        } catch {
        }
        if (frameAnimation === animation) {
          animation.cancel();
          frameAnimation = null;
        }
      };

      const showFallback = () => {
        fallback = true;
        stage.hidden = true;
        grid.hidden = false;
        if (grid.childElementCount) return;
        const coarse = coarsePointer();
        for (const photo of photos) {
          const polaroid = createFallbackPolaroid(photo, photos.length, coarse);
          polaroid.addEventListener("click", () => {
            void openPhoto(photo.index, elementRect(polaroid));
          });
          grid.append(polaroid);
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
          button.addEventListener("click", () => {
            void openPhoto(photo.index, elementRect(button));
          });
          item.append(button);
          list.append(item);
        }
      };

      const setHoverLabel = (index: number, x: number, y: number) => {
        if (!hoverLabel || !window.matchMedia("(pointer: fine)").matches)
          return;
        hoverLabel.hidden = false;
        hoverLabel.textContent = `Open · ${String(index + 1).padStart(3, "0")}`;
        hoverLabel.style.translate = `${x}px ${y}px`;
      };

      const hideHoverLabel = () => {
        if (!hoverLabel) return;
        hoverLabel.hidden = true;
      };

      const setHintFaded = () => {
        if (hint) hint.dataset.faded = "true";
      };

      const openPhoto = async (
        index: number,
        source: GallerySourceRect | null = null,
      ) => {
        if (!photos[index] || lightboxBusy) return;
        lightboxBusy = true;
        const token = ++lightboxToken;
        if (!(await preparePhoto(index, token))) {
          if (token === lightboxToken) lightboxBusy = false;
          return;
        }

        const canvasSource = canvas?.setLightboxOpen(true, index) ?? null;
        hideHoverLabel();
        overlay.style.setProperty(
          "--gallery-lightbox-duration",
          reducedMotion() ? "0.01ms" : "680ms",
        );
        overlay.dataset.galleryState = "open";
        void redrawPopupText(index, token);
        requestFullImage(index, token);
        lightboxClose.focus({ preventScroll: true });
        lightboxBusy = false;
        await animateStamp(canvasSource ?? source, true);
      };

      const currentFallbackRect = () => {
        const button = grid.querySelector<HTMLElement>(
          `[data-gallery-photo="${currentIndex}"]`,
        );
        return elementRect(button);
      };

      const closePhoto = async () => {
        if (
          overlay.dataset.galleryState !== "open" ||
          overlay.dataset.galleryClosing === "true"
        )
          return;
        lightboxBusy = true;
        ++lightboxToken;
        ++fullImageRequest;
        touchStartX = null;
        const target =
          canvas?.setLightboxOpen(true, currentIndex) ?? currentFallbackRect();
        overlay.style.setProperty(
          "--gallery-lightbox-duration",
          reducedMotion() ? "0.01ms" : "520ms",
        );
        overlay.dataset.galleryClosing = "true";
        await animateStamp(target, false);

        overlay.dataset.galleryState = "canvas";
        delete overlay.dataset.galleryClosing;
        canvas?.setLightboxOpen(false);
        const currentButton = list.querySelector<HTMLButtonElement>(
          `[data-gallery-photo="${currentIndex}"]`,
        );
        currentButton?.focus({ preventScroll: true });
        lightboxBusy = false;
      };

      const nextPhoto = async (direction: 1 | -1) => {
        if (!photos.length || lightboxBusy) return;
        lightboxBusy = true;
        frameAnimation?.cancel();
        frameAnimation = null;
        const index =
          (currentIndex + direction + photos.length) % photos.length;
        const token = ++lightboxToken;
        if (await preparePhoto(index, token)) {
          canvas?.setLightboxOpen(true, index);
          requestFullImage(index, token);
        }
        if (token === lightboxToken) lightboxBusy = false;
      };

      const onDocumentKeyDown = (event: KeyboardEvent) => {
        if (overlay.hidden) return;
        if (event.key === "Escape") {
          event.preventDefault();
          if (overlay.dataset.galleryState === "open") void closePhoto();
          else closeOverlay();
          return;
        }
        if (
          overlay.dataset.galleryState === "open" &&
          (event.key === "ArrowLeft" || event.key === "ArrowRight")
        ) {
          event.preventDefault();
          void nextPhoto(event.key === "ArrowRight" ? 1 : -1);
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
      };

      const onOverlayResize = () => {
        if (overlay.dataset.galleryState !== "open" || !currentImage) return;
        drawLightbox(currentIndex, currentImage);
      };

      const bindOverlayListeners = () => {
        if (overlayListenersBound) return;
        overlayListenersBound = true;
        document.addEventListener("keydown", onDocumentKeyDown);
        window.addEventListener("resize", onOverlayResize);
      };

      const unbindOverlayListeners = () => {
        if (!overlayListenersBound) return;
        overlayListenersBound = false;
        document.removeEventListener("keydown", onDocumentKeyDown);
        window.removeEventListener("resize", onOverlayResize);
      };

      const closeOverlay = () => {
        if (overlay.dataset.galleryState === "open") {
          void closePhoto();
          return;
        }
        openingToken += 1;
        ++lightboxToken;
        ++fullImageRequest;
        lightboxBusy = false;
        touchStartX = null;
        frameAnimation?.cancel();
        frameAnimation = null;
        overlay.dataset.galleryState = "closed";
        overlay.hidden = true;
        canvas?.pause();
        hideHoverLabel();
        unbindOverlayListeners();
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
            onStampClick: (index) => {
              void openPhoto(index);
            },
            onWebGLFailure: () => {
              canvas?.destroy();
              canvas = null;
              showFallback();
            },
          });
          if (!canvas) showFallback();
        } catch {
          if (token === openingToken) showFallback();
        }
      };

      const prefetchGallery = () => {
        if (galleryPrefetchStarted) return;
        galleryPrefetchStarted = true;
        galleryPrefetchObserver?.disconnect();
        galleryPrefetchObserver = null;
        openButton.removeEventListener("pointerenter", prefetchGallery);
        openButton.removeEventListener("pointerdown", prefetchGallery);
        openButton.removeEventListener("focus", prefetchGallery);
        const coarse = coarsePointer();
        const firstBatch = photos.slice(0, PREFETCH_BATCH_SIZE);
        void Promise.all([
          import("./canvas.ts"),
          ...firstBatch.map((photo) =>
            loadGalleryPhoto(coarse ? photo.coarse : photo.fine).catch(() => null),
          ),
        ]);
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
        bindOverlayListeners();
        closeButton.focus({ preventScroll: true });
        if (canvas) canvas.resume();
        else void bootCanvas(token);
      };

      fillList();
      openButton.addEventListener("click", openOverlay);
      openButton.addEventListener("pointerenter", prefetchGallery);
      openButton.addEventListener("pointerdown", prefetchGallery);
      openButton.addEventListener("focus", prefetchGallery);
      if ("IntersectionObserver" in window) {
        galleryPrefetchObserver = new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) prefetchGallery();
          },
          { rootMargin: "800px 0px" },
        );
        galleryPrefetchObserver.observe(root ?? openButton);
      }
      closeButton.addEventListener("click", closeOverlay);
      lightboxClose.addEventListener("click", () => {
        void closePhoto();
      });
      previousButton.addEventListener("click", () => {
        void nextPhoto(-1);
      });
      nextButton.addEventListener("click", () => {
        void nextPhoto(1);
      });
      scrim.addEventListener("click", () => {
        void closePhoto();
      });
      lightbox.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse") return;
        touchStartX = event.clientX;
      });
      lightbox.addEventListener("pointerup", (event) => {
        if (touchStartX === null) return;
        const delta = event.clientX - touchStartX;
        touchStartX = null;
        if (Math.abs(delta) > 40) void nextPhoto(delta < 0 ? 1 : -1);
      });
      lightbox.addEventListener("pointercancel", () => {
        touchStartX = null;
      });
    });
}
