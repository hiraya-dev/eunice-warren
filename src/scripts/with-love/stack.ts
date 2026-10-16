  import { gsap } from "gsap";
import { Draggable } from "gsap/Draggable";
import { sampleFillCount } from "@/lib/with-love/logic";

  gsap.registerPlugin(Draggable);

function initWithLoveStackCore() {
    document.querySelectorAll<HTMLElement>("[data-stacked-cards]").forEach(function (container) {
      const previous = (container as HTMLElement & { __destroyStack?: () => void }).__destroyStack;
      previous?.();

      type EasePreset = { duration: number; ease?: string };
      let easeBeforeRelease: EasePreset = { duration: 0.2, ease: "Power2.easeOut" };
      let easeAfterRelease: EasePreset = { duration: 1, ease: "elastic.out(1,0.75)" };
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (reducedMotion.matches) {
        easeBeforeRelease = { duration: 0 };
        easeAfterRelease = { duration: 0 };
      }
      let activeDeg = -2;
      let inactiveDeg = 5;
      const list = container.querySelector<HTMLElement>("[data-stacked-cards-list]");
      if (!list) return;
      const cardList = list;
      const initialItems = Array.from(list.querySelectorAll<HTMLElement>(":scope > [data-stacked-cards-item]"));
      if (initialItems.length < 3) {
        console.error("[StackedCards] Minimum of 3 cards required. Found:", initialItems.length, list);
        return;
      }
      let dragFirst: Draggable;
      let dragSecond: Draggable;
      let firstItem: HTMLElement;
      let secondItem: HTMLElement;
      let firstEl: HTMLElement;
      let secondEl: HTMLElement;
      let full: number;
      let t: number;

      function restack() {
        const items = Array.from(cardList.querySelectorAll<HTMLElement>("[data-stacked-cards-item]"));
        items.forEach(function (item) { item.classList.remove("is--active", "is--second"); });
        items[0].style.zIndex = "3";
        items[0].style.transform = `rotate(${activeDeg}deg)`;
        items[0].style.pointerEvents = "auto";
        items[0].classList.add("is--active");
        items[1].style.zIndex = "2";
        items[1].style.transform = `rotate(${inactiveDeg}deg)`;
        items[1].style.pointerEvents = "none";
        items[1].classList.add("is--second");
        items[2].style.zIndex = "1";
        items[2].style.transform = `rotate(${activeDeg}deg)`;
        items.slice(3).forEach(function (item) {
          item.style.zIndex = "0";
          item.style.transform = `rotate(${inactiveDeg}deg)`;
        });
      }

      function setupDraggables() {
        restack();
        const items = Array.from(cardList.querySelectorAll<HTMLElement>(":scope > [data-stacked-cards-item]"));
        firstItem = items[0];
        secondItem = items[1];
        firstEl = firstItem.querySelector<HTMLElement>("[data-stacked-cards-card]")!;
        secondEl = secondItem.querySelector<HTMLElement>("[data-stacked-cards-card]")!;
        const width = firstEl.getBoundingClientRect().width;
        full = width * 1.15;
        t = width * 0.1;
        dragFirst?.kill();
        dragSecond?.kill();
        dragFirst = Draggable.create(firstEl, {
          type: "x",
          onPress() { firstEl.classList.add("is--dragging"); },
          onRelease() { firstEl.classList.remove("is--dragging"); },
          onDrag() {
            let raw = this.x;
            if (Math.abs(raw) > full) {
              const over = Math.abs(raw) - full;
              raw = (raw > 0 ? 1 : -1) * (full + over * 0.1);
            }
            gsap.set(firstEl, { x: raw, rotation: 0 });
          },
          onDragEnd() {
            const x = this.x;
            const dir = x > 0 ? "right" : "left";
            this.disable?.();
            dragSecond?.enable?.();
            firstItem.style.pointerEvents = "none";
            secondItem.style.pointerEvents = "auto";
            if (Math.abs(x) <= t) {
              gsap.to(firstEl, { x: 0, rotation: 0, ...easeBeforeRelease, onComplete: resetCycle });
            } else if (Math.abs(x) <= full) {
              flick(dir, false, x);
            } else {
              flick(dir, true);
            }
          },
        })[0];
        dragSecond = Draggable.create(secondEl, {
          type: "x",
          onPress() { secondEl.classList.add("is--dragging"); },
          onRelease() { secondEl.classList.remove("is--dragging"); },
          onDrag() {
            let raw = this.x;
            if (Math.abs(raw) > full) {
              const over = Math.abs(raw) - full;
              raw = (raw > 0 ? 1 : -1) * (full + over * 0.2);
            }
            gsap.set(secondEl, { x: raw, rotation: 0 });
          },
          onDragEnd() {
            gsap.to(secondEl, { x: 0, rotation: 0, ...easeBeforeRelease });
          },
        })[0];
        dragFirst?.enable?.();
        dragSecond?.disable?.();
        firstItem.style.pointerEvents = "auto";
        secondItem.style.pointerEvents = "none";
      }

      function flick(dir?: "left" | "right", skipHome = false, releaseX = 0) {
        if (!(dir === "left" || dir === "right")) {
          dir = activeDeg > 0 ? "right" : "left";
        }
        dragFirst?.disable?.();
        const item = cardList.querySelector<HTMLElement>("[data-stacked-cards-item]")!;
        const card = item.querySelector<HTMLElement>("[data-stacked-cards-card]")!;
        const exitX = dir === "right" ? full : -full;
        if (skipHome) {
          const visualX = gsap.getProperty(card, "x");
          cardList.appendChild(item);
          [activeDeg, inactiveDeg] = [inactiveDeg, activeDeg];
          restack();
          gsap.fromTo(card, { x: visualX, rotation: 0 }, { x: 0, rotation: 0, ...easeAfterRelease, onComplete: resetCycle });
        } else {
          gsap.fromTo(card, { x: releaseX, rotation: 0 }, {
            x: exitX,
            ...easeBeforeRelease,
            onComplete() {
              gsap.set(card, { x: 0, rotation: 0 });
              cardList.appendChild(item);
              [activeDeg, inactiveDeg] = [inactiveDeg, activeDeg];
              resetCycle();
              const newCard = item.querySelector<HTMLElement>("[data-stacked-cards-card]")!;
              gsap.fromTo(newCard, { x: exitX }, { x: 0, ...easeAfterRelease, onComplete: resetCycle });
            },
          });
        }
      }

      function resetCycle() {
        cardList.querySelectorAll<HTMLElement>("[data-stacked-cards-card].is--dragging").forEach(function (el) {
          el.classList.remove("is--dragging");
        });
        setupDraggables();
      }

      setupDraggables();
      (container as HTMLElement & { __destroyStack?: () => void }).__destroyStack = () => {
        dragFirst?.kill();
        dragSecond?.kill();
      };
      container.querySelectorAll<HTMLButtonElement>('[data-stacked-cards-control="next"]').forEach(function (btn) {
        btn.onclick = function () { flick(); };
      });
    });
  }

  type GuestNote = { id: string; name: string; city: string; message: string; photoUrl: string };

  function createGuestCard(note: GuestNote) {
    const item = document.createElement("div");
    item.dataset.stackedCardsItem = "";
    item.dataset.noteId = note.id;
    item.className = "stack-cards__item";
    const article = document.createElement("article");
    article.dataset.stackedCardsCard = "";
    article.className = "stack-cards__card";
    const image = document.createElement("img");
    image.className = "with-love_photo";
    image.src = note.photoUrl;
    image.alt = `Photo shared by ${note.name}`;
    image.width = 1600;
    image.height = 1200;
    image.loading = "lazy";
    const message = document.createElement("p");
    message.className = "with-love_message";
    message.textContent = `“${note.message}”`;
    const attribution = document.createElement("p");
    attribution.className = "with-love_attribution";
    attribution.textContent = `— ${note.name}${note.city ? `, ${note.city}` : ""}`;
    article.append(image, message, attribution);
    item.append(article);
    return item;
  }

  function loadGuestNotes(container: HTMLElement) {
    if (container.dataset.notesLoaderInitialized === "true") return;
    container.dataset.notesLoaderInitialized = "true";
    const list = container.querySelector<HTMLElement>("[data-stacked-cards-list]");
    if (!list) return;
    const samples = Array.from(list.children).map((item) => item.cloneNode(true) as HTMLElement);
    const section = container.closest<HTMLElement>("section");
    const rebuild = (notes: GuestNote[]) => {
      const apply = () => {
        const moving = list.querySelector<HTMLElement>(".is--dragging") ||
          Array.from(list.querySelectorAll<HTMLElement>("[data-stacked-cards-card]")).some((card) => gsap.isTweening(card));
        if (moving) {
          requestAnimationFrame(apply);
          return;
        }
        list.replaceChildren(...notes.map(createGuestCard), ...samples.slice(0, sampleFillCount(notes.length, samples.length)));
        initWithLoveStack();
      };
      apply();
    };
    const load = async () => {
      if (container.dataset.notesLoaded === "true") return;
      container.dataset.notesLoaded = "true";
      try {
        const response = await fetch("/api/with-love/notes");
        const data = (await response.json()) as { notes?: GuestNote[] };
        const notes = data.notes ?? [];
        if (notes.length > 0) rebuild(notes);
      } catch {
        // The sample stack remains visible when guest notes are unavailable.
      } finally {
        if (section) section.dataset.withLoveNotes = "loaded";
      }
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        void load();
      }
    }, { rootMargin: "100%" });
    observer.observe(container);
    container.addEventListener("with-love-note", (event) => {
      const note = (event as CustomEvent<GuestNote>).detail;
      const apply = () => {
        const moving = list.querySelector<HTMLElement>(".is--dragging") || Array.from(list.querySelectorAll<HTMLElement>("[data-stacked-cards-card]")).some((card) => gsap.isTweening(card));
        if (moving) return requestAnimationFrame(apply);
        list.prepend(createGuestCard(note));
        initWithLoveStack();
      };
      apply();
    });
  }

  export function initWithLoveStack() {
    initWithLoveStackCore();
    document.querySelectorAll<HTMLElement>("[data-stacked-cards]").forEach(loadGuestNotes);
  }
