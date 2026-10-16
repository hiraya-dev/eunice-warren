import { actions } from "astro:actions";
import { processPhoto } from "./photo";
import { createTurnstileController, isFakeTurnstileMode } from "../turnstile";

type Note = { id: string; name: string; city: string; message: string; photoUrl: string };

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
    let photo: File | undefined;
    let previewUrl: string | undefined;

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
        previewUrl = URL.createObjectURL(photo);
        preview.src = previewUrl;
        preview.hidden = false;
        empty.forEach((element) => (element.hidden = true));
        change.hidden = false;
        slot.classList.add("is-filled");
        update();
      } catch (caught) {
        photo = undefined;
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
    message.oninput = name.oninput = city.oninput = update;

    form.onsubmit = async (event) => {
      event.preventDefault();
      if (!photo || !message.value.trim() || !name.value.trim()) return;
      submit.disabled = true;
      submit.textContent = "Pinning…";
      error.hidden = true;
      try {
        const data = new FormData();
        data.set("photo", photo);
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
