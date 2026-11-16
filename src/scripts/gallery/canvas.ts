import {
  CanvasTexture,
  Color,
  Fog,
  LinearFilter,
  OrthographicCamera,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector2,
  WebGLRenderer,
} from "three";
import { createStampCanvas } from "./stamp-texture.ts";

export type GalleryCanvasPhoto = {
  index: number;
  fine: string;
  coarse: string;
  width: number;
  height: number;
  orientation: "portrait" | "landscape";
};

type CanvasOptions = {
  stage: HTMLElement;
  photos: GalleryCanvasPhoto[];
  reducedMotion: boolean;
  onInteraction: () => void;
  onHover: (index: number, x: number, y: number) => void;
  onHoverEnd: () => void;
  onStampClick: (index: number, rect: { left: number; top: number; width: number; height: number }) => void;
};

export type GalleryCanvas = {
  pause: () => void;
  resume: () => void;
  setLightboxOpen: (open: boolean) => void;
  destroy: () => void;
};

type StampData = {
  index: number;
  targetX: number;
  targetY: number;
  startX: number;
  startY: number;
  width: number;
  height: number;
  rotation: number;
};

const CELL_WIDTH = 720;
const CELL_HEIGHT = 560;
const CELL_RADIUS = 4;
const INTRO_DURATION = 1200;
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const modulo = (value: number, divisor: number) =>
  ((value % divisor) + divisor) % divisor;

const seeded = (x: number, y: number, slot: number) => {
  let value =
    Math.imul(x + 101, 374761393) ^
    Math.imul(y + 37, 668265263) ^
    Math.imul(slot + 11, 2246822519);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};

const stampData = (
  photos: GalleryCanvasPhoto[],
  cellX: number,
  cellY: number,
  slot: number,
): StampData => {
  const index = modulo(cellX * 5 + cellY * 17 + slot * 29, photos.length);
  const photo = photos[index];
  const random = seeded(cellX, cellY, slot);
  const randomY = seeded(cellX + 7, cellY - 3, slot + 4);
  const randomSize = seeded(cellX - 13, cellY + 9, slot + 8);
  const width = 150 + randomSize * 130;
  const height = photo.orientation === "landscape" ? width * 0.8 : width * 1.25;
  const targetX = cellX * CELL_WIDTH + (random - 0.5) * (CELL_WIDTH - width);
  const targetY =
    cellY * CELL_HEIGHT + (randomY - 0.5) * (CELL_HEIGHT - height);
  return {
    index,
    targetX,
    targetY,
    startX: targetX * 0.08,
    startY: targetY * 0.08,
    width,
    height,
    rotation: (seeded(cellX + 2, cellY + 5, slot + 2) - 0.5) * 0.28,
  };
};

const isFinePointer = () => window.matchMedia("(pointer: fine)").matches;

export function createGalleryCanvas(
  options: CanvasOptions,
): GalleryCanvas | null {
  const {
    stage,
    photos,
    reducedMotion,
    onInteraction,
    onHover,
    onHoverEnd,
    onStampClick,
  } = options;
  if (!photos.length) return null;

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
  } catch {
    return null;
  }

  const coarsePointer = !isFinePointer();
  const pixelRatio = Math.min(
    window.devicePixelRatio || 1,
    coarsePointer ? 1.25 : 1.5,
  );
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0xf5efe3, 1);
  renderer.domElement.setAttribute("aria-hidden", "true");
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  stage.replaceChildren(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0xf5efe3);
  scene.fog = new Fog(0xf5efe3, 950, 2400);
  const camera = new OrthographicCamera(-1, 1, 1, -1, -1000, 5000);
  camera.position.z = 1000;
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const sprites: Sprite[] = [];
  const textureCache = new Map<number, CanvasTexture>();
  const textureQueue: number[] = [];
  const textureQueued = new Set<number>();
  const pointers = new Map<number, { x: number; y: number }>();
  let textureQueueRunning = false;
  let destroyed = false;
  let running = true;
  let lightboxOpen = false;
  let frame = 0;
  let textureTimer = 0;
  let introStart = performance.now();
  let introActive = !reducedMotion;
  let activeCellX = Number.NaN;
  let activeCellY = Number.NaN;
  let hovered: Sprite | null = null;
  let dragging = false;
  let moved = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let lastX = 0;
  let lastY = 0;
  let lastPinchDistance = 0;
  let velocityX = 0;
  let velocityY = 0;
  let zoom = 1;

  const resize = () => {
    const rect = stage.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    renderer.setSize(width, height, false);
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.updateProjectionMatrix();
  };

  const cameraCenterCell = () => ({
    x: Math.floor(camera.position.x / CELL_WIDTH),
    y: Math.floor(camera.position.y / CELL_HEIGHT),
  });

  const updateSpriteOpacity = (sprite: Sprite) => {
    const distance = Math.hypot(
      sprite.position.x - camera.position.x,
      sprite.position.y - camera.position.y,
    );
    const material = sprite.material as SpriteMaterial;
    material.opacity = clamp(1.04 - distance / 1900, 0.45, 1);
  };

  const queueTexture = (index: number) => {
    if (textureCache.has(index) || textureQueued.has(index)) return;
    textureQueued.add(index);
    textureQueue.push(index);
    if (!textureQueueRunning) void processTextureQueue();
  };

  const applyTexture = (index: number, texture: CanvasTexture) => {
    textureCache.set(index, texture);
    for (const sprite of sprites) {
      if (sprite.userData.photoIndex !== index) continue;
      const material = sprite.material as SpriteMaterial;
      material.map = texture;
      material.needsUpdate = true;
    }
  };

  async function processTextureQueue() {
    if (textureQueueRunning || destroyed) return;
    textureQueueRunning = true;
    const started = performance.now();
    while (textureQueue.length && !destroyed) {
      const index = textureQueue.shift()!;
      textureQueued.delete(index);
      const photo = photos[index];
      try {
        const canvas = await createStampCanvas(
          { ...photo, fine: coarsePointer ? photo.coarse : photo.fine },
          coarsePointer ? 360 : 512,
        );
        const texture = new CanvasTexture(canvas);
        texture.minFilter = LinearFilter;
        texture.magFilter = LinearFilter;
        texture.generateMipmaps = false;
        applyTexture(index, texture);
      } catch {
        // A failed texture leaves its sprite transparent; the DOM list remains available.
      }
      if (performance.now() - started >= 6) break;
    }
    textureQueueRunning = false;
    if (textureQueue.length && !destroyed) {
      textureTimer = window.setTimeout(() => void processTextureQueue(), 0);
    }
  }

  const clearSprites = () => {
    while (sprites.length) {
      const sprite = sprites.pop()!;
      scene.remove(sprite);
      (sprite.material as SpriteMaterial).dispose();
    }
  };

  const refreshCells = () => {
    const center = cameraCenterCell();
    if (center.x === activeCellX && center.y === activeCellY) return;
    activeCellX = center.x;
    activeCellY = center.y;
    clearSprites();
    for (
      let cellY = center.y - CELL_RADIUS;
      cellY <= center.y + CELL_RADIUS;
      cellY += 1
    ) {
      for (
        let cellX = center.x - CELL_RADIUS;
        cellX <= center.x + CELL_RADIUS;
        cellX += 1
      ) {
        for (let slot = 0; slot < 5; slot += 1) {
          const data = stampData(photos, cellX, cellY, slot);
          const material = new SpriteMaterial({
            transparent: true,
            depthTest: false,
            fog: true,
            opacity: 0,
          });
          const sprite = new Sprite(material);
          sprite.position.set(
            reducedMotion ? data.targetX : data.startX,
            reducedMotion ? data.targetY : data.startY,
            0,
          );
          sprite.scale.set(data.width, data.height, 1);
          sprite.rotation.z = data.rotation;
          sprite.userData = { ...data, photoIndex: data.index };
          scene.add(sprite);
          sprites.push(sprite);
          const texture = textureCache.get(data.index);
          if (texture) {
            material.map = texture;
            material.needsUpdate = true;
          } else {
            queueTexture(data.index);
          }
          updateSpriteOpacity(sprite);
        }
      }
    }
  };

  const render = () => {
    if (destroyed || !running) return;
    const now = performance.now();
    if (introActive) {
      const progress = reducedMotion
        ? 1
        : clamp((now - introStart) / INTRO_DURATION, 0, 1);
      const eased = 1 - (1 - progress) ** 3;
      for (const sprite of sprites) {
        const data = sprite.userData as StampData;
        sprite.position.x = data.startX + (data.targetX - data.startX) * eased;
        sprite.position.y = data.startY + (data.targetY - data.startY) * eased;
        updateSpriteOpacity(sprite);
      }
      if (progress >= 1) introActive = false;
    }
    if (!reducedMotion && !dragging && !introActive && !lightboxOpen) {
      velocityX *= 0.91;
      velocityY *= 0.91;
      camera.position.x += velocityX;
      camera.position.y += velocityY;
      if (Math.abs(velocityX) < 0.01) velocityX = 0;
      if (Math.abs(velocityY) < 0.01) velocityY = 0;
    }
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    refreshCells();
    for (const sprite of sprites) updateSpriteOpacity(sprite);
    renderer.render(scene, camera);

    const shouldContinue =
      introActive || dragging || velocityX !== 0 || velocityY !== 0;
    if (shouldContinue) frame = requestAnimationFrame(render);
    else frame = 0;
  };

  const wake = () => {
    if (frame === 0 && running && !destroyed)
      frame = requestAnimationFrame(render);
  };

  const setPointer = (event: PointerEvent) => {
    const rect = stage.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  };

  const hitTest = (event: PointerEvent) => {
    setPointer(event);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(sprites, false)[0]?.object as
      Sprite | undefined;
  };

  const screenRect = (sprite: Sprite) => {
    const rect = stage.getBoundingClientRect();
    const data = sprite.userData as StampData;
    const projected = sprite.position.clone().project(camera);
    const width = data.width * camera.zoom;
    const height = data.height * camera.zoom;
    return {
      left: rect.left + ((projected.x + 1) * rect.width) / 2 - width / 2,
      top: rect.top + ((1 - projected.y) * rect.height) / 2 - height / 2,
      width,
      height,
    };
  };

  const updateHover = (event: PointerEvent) => {
    if (!isFinePointer() || dragging || lightboxOpen) return;
    const hit = hitTest(event) ?? null;
    if (hit === hovered) return;
    if (hovered) {
      const previous = hovered.userData as StampData;
      hovered.scale.set(previous.width, previous.height, 1);
    }
    hovered = hit;
    if (!hit) {
      onHoverEnd();
      stage.style.cursor = "grab";
      return;
    }
    const rect = stage.getBoundingClientRect();
    const data = hit.userData as StampData;
    hit.scale.set(data.width * 1.06, data.height * 1.06, 1);
    const projected = hit.position.clone().project(camera);
    const width = data.width * camera.zoom;
    const height = data.height * camera.zoom;
    onHover(
      data.index,
      ((projected.x + 1) * rect.width) / 2 - width / 2,
      ((1 - projected.y) * rect.height) / 2 + height / 2 + 8,
    );
    stage.style.cursor = "pointer";
  };

  const applyPan = (deltaX: number, deltaY: number, momentum: boolean) => {
    camera.position.x -= deltaX / zoom;
    camera.position.y += deltaY / zoom;
    if (momentum && !reducedMotion) {
      velocityX = -deltaX / zoom;
      velocityY = deltaY / zoom;
    }
    refreshCells();
    wake();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (lightboxOpen) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    stage.setPointerCapture?.(event.pointerId);
    if (pointers.size === 2) {
      const values = [...pointers.values()];
      lastPinchDistance = Math.hypot(
        values[0].x - values[1].x,
        values[0].y - values[1].y,
      );
      moved = true;
      return;
    }
    dragging = true;
    moved = false;
    dragStartX = lastX = event.clientX;
    dragStartY = lastY = event.clientY;
    stage.style.cursor = "grabbing";
    wake();
  };

  const onPointerMove = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) {
      updateHover(event);
      return;
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) {
      const values = [...pointers.values()];
      const distance = Math.hypot(
        values[0].x - values[1].x,
        values[0].y - values[1].y,
      );
      if (lastPinchDistance)
        zoom = clamp(zoom * (distance / lastPinchDistance), 0.65, 1.5);
      lastPinchDistance = distance;
      onInteraction();
      wake();
      return;
    }
    if (!dragging) return;
    const deltaX = event.clientX - lastX;
    const deltaY = event.clientY - lastY;
    if (Math.hypot(event.clientX - dragStartX, event.clientY - dragStartY) > 8)
      moved = true;
    lastX = event.clientX;
    lastY = event.clientY;
    onInteraction();
    applyPan(deltaX, deltaY, true);
    updateHover(event);
  };

  const onPointerUp = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size) return;
    const wasDrag = moved;
    dragging = false;
    stage.releasePointerCapture?.(event.pointerId);
    stage.style.cursor = "grab";
    if (!wasDrag) {
      const hit = hitTest(event);
      if (hit) onStampClick((hit.userData as StampData).index, screenRect(hit));
    }
    if (!reducedMotion) wake();
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    onInteraction();
    applyPan(event.deltaX, event.deltaY, true);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (
      lightboxOpen ||
      (event.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName))
    )
      return;
    const amount = event.shiftKey ? 90 : 45;
    let deltaX = 0;
    let deltaY = 0;
    if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a")
      deltaX = -amount;
    if (event.key === "ArrowRight" || event.key.toLowerCase() === "d")
      deltaX = amount;
    if (event.key === "ArrowUp" || event.key.toLowerCase() === "w")
      deltaY = -amount;
    if (event.key === "ArrowDown" || event.key.toLowerCase() === "s")
      deltaY = amount;
    if (!deltaX && !deltaY) return;
    event.preventDefault();
    onInteraction();
    applyPan(deltaX, deltaY, true);
  };

  const onResize = () => {
    resize();
    wake();
  };

  resize();
  refreshCells();
  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("pointermove", onPointerMove);
  stage.addEventListener("pointerup", onPointerUp);
  stage.addEventListener("pointercancel", onPointerUp);
  stage.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", onResize);
  wake();

  return {
    pause() {
      running = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (hovered) {
        const data = hovered.userData as StampData;
        hovered.scale.set(data.width, data.height, 1);
        hovered = null;
      }
      onHoverEnd();
    },
    resume() {
      running = true;
      wake();
    },
    setLightboxOpen(open) {
      lightboxOpen = open;
      if (open) {
        velocityX = 0;
        velocityY = 0;
        if (hovered) {
          const data = hovered.userData as StampData;
          hovered.scale.set(data.width, data.height, 1);
          hovered = null;
        }
        onHoverEnd();
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
      } else {
        wake();
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      running = false;
      if (frame) cancelAnimationFrame(frame);
      if (textureTimer) window.clearTimeout(textureTimer);
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", onPointerUp);
      stage.removeEventListener("pointercancel", onPointerUp);
      stage.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      if (hovered) {
        const data = hovered.userData as StampData;
        hovered.scale.set(data.width, data.height, 1);
      }
      clearSprites();
      for (const texture of textureCache.values()) texture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
