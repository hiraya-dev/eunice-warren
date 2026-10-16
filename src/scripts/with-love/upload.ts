import { actions } from "astro:actions";
import { processPhoto } from "./photo";
import { createTurnstileController, isFakeTurnstileMode } from "../turnstile";
import { clampPan, pinchZoom, sourceRect, type CropFrame, type CropImage, type CropTransform } from "./crop";

type Note = { id: string; name: string; city: string; message: string; photoUrl: string };

const encodeCroppedPhoto = async (file: File, image: CropImage, frame: CropFrame, transform: CropTransform) => {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const rect = sourceRect(transform, image, frame);
  // A multiple of 8 keeps the output exactly 8:7 after rounding.
  const width = Math.max(8, Math.floor(Math.min(1600, rect.width) / 8) * 8);
  const height = (width / 8) * 7;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, width, height);
  bitmap.close();
  let quality = 0.82;
  let blob: Blob;
  do {
    blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("encode"))), "image/jpeg", quality),
    );
    quality -= 0.08;
  } while (blob.size > 400_000 && quality >= 0.5);
  return new File([blob], "polaroid.jpg", { type: "image/jpeg" });
};

const makeCard = (note: Note) => {
  const article = document.createElement("article");
  article.className = "stack-cards__card";
  article.dataset.stackedCardsCard = "";
  const image = document.createElement("img");
  image.className = "with-love_photo";
  image.src = note.photoUrl;
  image.alt = `Photo shared by ${note.name}`;
  image.loading = "lazy";
  const message = document.createElement("p");
  message.className = "with-love_message";
  message.textContent = `“${note.message}”`;
  const attribution = document.createElement("p");
  attribution.className = "with-love_attribution";
  attribution.textContent = `— ${note.name}${note.city ? `, ${note.city}` : ""}`;
  article.append(image, message, attribution);
  return article;
};

export function initWithLoveUpload() {
  document.querySelectorAll<HTMLElement>("[data-with-love-upload]").forEach((root) => {
    if (root.dataset.ready === "true") return;
    root.dataset.ready = "true";
    const form = root.querySelector<HTMLFormElement>("[data-with-love-form]")!;
    const input = root.querySelector<HTMLInputElement>("[data-photo-input]")!;
    const slot = root.querySelector<HTMLElement>("[data-photo-slot]")!;
    const preview = root.querySelector<HTMLImageElement>("[data-photo-preview]")!;
    const change = root.querySelector<HTMLElement>("[data-change-photo]")!;
    const empty = root.querySelectorAll<HTMLElement>("[data-photo-empty], [data-photo-hint]");
    const message = root.querySelector<HTMLTextAreaElement>("[data-message]")!;
    const name = root.querySelector<HTMLInputElement>("[data-name]")!;
    const city = root.querySelector<HTMLInputElement>("[data-city]")!;
    const submit = root.querySelector<HTMLButtonElement>("[data-submit]")!;
    const error = root.querySelector<HTMLElement>("[data-form-error]")!;
    const fakeMode = isFakeTurnstileMode(import.meta.env.PUBLIC_RSVP_STORE, import.meta.env.DEV);
    const turnstile = createTurnstileController(fakeMode);
    const turnstileContainer = root.querySelector<HTMLElement>("[data-turnstile]")!;
    const cropControls = root.querySelector<HTMLElement>("[data-crop-controls]")!;
    const zoomSlider = root.querySelector<HTMLInputElement>("[data-zoom]")!;
    let photo: File | undefined;
    let previewUrl: string | undefined;
    let sourceImage: CropImage | undefined;
    let crop: CropTransform = { zoom: 1, panX: 0, panY: 0 };
    const pointers = new Map<number, { x: number; y: number }>();
    let lastPointer: { x: number; y: number } | undefined;
    let pinchStartDistance = 0;
    let pinchStartZoom = 1;
    let frameRequest = 0;

    const frame = (): CropFrame => ({ width: slot.clientWidth, height: slot.clientHeight });
    const renderCrop = () => {
      if (!sourceImage) return;
      crop = clampPan(crop, sourceImage, frame());
      preview.style.transform = `translate3d(${crop.panX}px, ${crop.panY}px, 0) scale(${crop.zoom})`;
      zoomSlider.value = String(crop.zoom);
    };
    const scheduleCropRender = () => {
      if (frameRequest) return;
      frameRequest = requestAnimationFrame(() => {
        frameRequest = 0;
        renderCrop();
      });
    };
    const resetCrop = () => {
      crop = { zoom: 1, panX: 0, panY: 0 };
      zoomSlider.value = "1";
      renderCrop();
    };

    const update = () => {
      root.querySelector<HTMLElement>("[data-counter]")!.textContent = `${message.value.trim().length} / 140`;
      submit.disabled = !(photo && message.value.trim() && name.value.trim());
    };
    const choose = async (file?: File) => {
      if (!file) return;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = undefined;
      try {
        photo = await processPhoto(file);
        if (photo.size > 2 * 1024 * 1024) throw new Error("photo-too-large");
        const bitmap = await createImageBitmap(photo);
        sourceImage = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        resetCrop();
        previewUrl = URL.createObjectURL(photo);
        preview.src = previewUrl;
        preview.hidden = false;
        empty.forEach((element) => (element.hidden = true));
        change.hidden = false;
        cropControls.hidden = false;
        slot.classList.add("is-filled");
        update();
      } catch (caught) {
        photo = undefined;
        sourceImage = undefined;
        cropControls.hidden = true;
        const heic = /image\/(heic|heif)/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
        error.textContent = caught instanceof Error && caught.message === "photo-too-large"
          ? "That photo is too large — try another one."
          : heic
            ? "This photo is in iPhone format (HEIC) and couldn't be opened here. Try uploading it from your phone, or save it as a JPEG first."
            : "That file doesn't look like a photo — try another one.";
        error.hidden = false;
      }
    };
    input.onchange = () => void choose(input.files?.[0]);
    slot.ondragover = (event) => { event.preventDefault(); slot.classList.add("is-dragging"); };
    slot.ondragleave = () => slot.classList.remove("is-dragging");
    slot.ondrop = (event) => { event.preventDefault(); slot.classList.remove("is-dragging"); void choose(event.dataTransfer?.files[0]); };
    slot.onpointerdown = (event) => {
      if (!photo) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      slot.setPointerCapture(event.pointerId);
      if (pointers.size === 2) {
        const [first, second] = [...pointers.values()];
        pinchStartDistance = Math.hypot(first.x - second.x, first.y - second.y);
        pinchStartZoom = crop.zoom;
        lastPointer = undefined;
      } else {
        lastPointer = { x: event.clientX, y: event.clientY };
      }
    };
    slot.onpointermove = (event) => {
      if (!photo || !pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2) {
        const [first, second] = [...pointers.values()];
        crop.zoom = pinchZoom(pinchStartZoom, pinchStartDistance, Math.hypot(first.x - second.x, first.y - second.y));
      } else if (lastPointer) {
        crop.panX += event.clientX - lastPointer.x;
        crop.panY += event.clientY - lastPointer.y;
        lastPointer = { x: event.clientX, y: event.clientY };
      }
      scheduleCropRender();
    };
    const finishPointer = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchStartDistance = 0;
      lastPointer = pointers.size === 1 ? [...pointers.values()][0] : undefined;
    };
    slot.onpointerup = finishPointer;
    slot.onpointercancel = finishPointer;
    slot.onwheel = (event) => {
      if (!photo || !event.ctrlKey) return;
      event.preventDefault();
      crop.zoom *= Math.exp(-event.deltaY * 0.002);
      scheduleCropRender();
    };
    slot.onkeydown = (event) => {
      if (!photo || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const amount = (event.shiftKey ? 0.1 : 0.02) * (event.key === "ArrowLeft" || event.key === "ArrowRight" ? frame().width : frame().height);
      if (event.key === "ArrowLeft") crop.panX -= amount;
      if (event.key === "ArrowRight") crop.panX += amount;
      if (event.key === "ArrowUp") crop.panY -= amount;
      if (event.key === "ArrowDown") crop.panY += amount;
      scheduleCropRender();
    };
    zoomSlider.oninput = () => {
      crop.zoom = Number(zoomSlider.value);
      scheduleCropRender();
    };
    message.oninput = name.oninput = city.oninput = update;

    form.onsubmit = async (event) => {
      event.preventDefault();
      if (!photo || !message.value.trim() || !name.value.trim()) return;
      submit.disabled = true;
      submit.textContent = "Pinning…";
      error.hidden = true;
      try {
        const data = new FormData();
        data.set("photo", await encodeCroppedPhoto(photo, sourceImage!, frame(), crop));
        data.set("message", message.value.trim());
        data.set("name", name.value.trim());
        data.set("city", city.value.trim());
        data.set("turnstileToken", await turnstile.getToken(turnstileContainer));
        const result = await actions.withLove.submit(data);
        if (result.error || !result.data) throw new Error(result.error?.message);
        const note = result.data.note;
        root.closest("section")?.querySelector<HTMLElement>("[data-stacked-cards]")?.dispatchEvent(new CustomEvent("with-love-note", { detail: note }));
        root.querySelector<HTMLElement>("[data-sent-name]")!.textContent = note.name;
        root.querySelector<HTMLElement>("[data-sent-card]")!.replaceChildren(makeCard(note));
        form.hidden = true;
        root.querySelector<HTMLElement>("[data-sent]")!.hidden = false;
      } catch (caught) {
        error.textContent = caught instanceof Error && caught.message ? caught.message : "Something went wrong — please try again.";
        error.hidden = false;
        submit.disabled = false;
        submit.textContent = "Pin it to the stack";
        update();
      } finally {
        turnstile.reset();
      }
    };
    root.querySelector<HTMLButtonElement>("[data-another]")!.onclick = () => {
      form.reset();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = undefined;
      photo = undefined;
      sourceImage = undefined;
      resetCrop();
      cropControls.hidden = true;
      preview.hidden = true;
      change.hidden = true;
      empty.forEach((element) => (element.hidden = false));
      slot.classList.remove("is-filled");
      root.querySelector<HTMLElement>("[data-sent]")!.hidden = true;
      form.hidden = false;
      submit.textContent = "Pin it to the stack";
      error.hidden = true;
      update();
    };
  });
}
