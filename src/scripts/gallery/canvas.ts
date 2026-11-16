import {
  CanvasTexture,
  Color,
  LinearFilter,
  LinearMipmapLinearFilter,
  OrthographicCamera,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from "three";
import { createStampCanvas, stampPadding } from "./stamp-texture.ts";

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

type Tier = "near" | "mid" | "far";

type StampData = {
  index: number;
  tier: Tier;
  textureKey: number;
  targetX: number;
  targetY: number;
  startX: number;
  startY: number;
  /** The stamp's own size, which is what the screen rect and hover label use. */
  width: number;
  height: number;
  /** Sprite size: the stamp plus the transparent margin that holds its baked shadow. */
  fullWidth: number;
  fullHeight: number;
  /** Where the stamp sits inside the sprite's uv space (0..1), for hit-testing. */
  insetU: number;
  insetV: number;
  rotation: number;
  opacity: number;
  renderOrder: number;
};

// The space is a grid of slots, one stamp per slot, jittered inside the slot. A stamp's rotated
// bounding box always fits inside its slot, so stamps never overlap across slots or cells.
const SLOT_WIDTH = 360;
const SLOT_HEIGHT = 320;
const SLOT_MARGIN = 8;
const CELL_SLOTS = 2;
const CELL_WIDTH = SLOT_WIDTH * CELL_SLOTS;
const CELL_HEIGHT = SLOT_HEIGHT * CELL_SLOTS;
const CELL_RADIUS = 4;
const MAX_TILT = (8 * Math.PI) / 180;
const FAR_TEXTURE_OFFSET = 100000;
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

// Long-edge ranges per depth tier (Paper: near ~280, mid ~170-185, far ~100).
const TIERS: Record<Tier, { min: number; max: number; opacity: number; order: number }> = {
  near: { min: 240, max: 270, opacity: 1, order: 2 },
  mid: { min: 160, max: 195, opacity: 1, order: 1 },
  far: { min: 90, max: 125, opacity: 0.5, order: 0 },
};

const stampData = (
  photos: GalleryCanvasPhoto[],
  slotX: number,
  slotY: number,
): StampData => {
  // 7 and 13 keep every photo unique inside any window of 13x11 slots.
  const index = modulo(slotX * 7 + slotY * 13, photos.length);
  const landscape = photos[index].orientation === "landscape";
  const pick = seeded(slotX, slotY, 1);
  const tier: Tier = pick < 0.36 ? "near" : pick < 0.84 ? "mid" : "far";
  const range = TIERS[tier];
  const longEdge = range.min + seeded(slotX, slotY, 2) * (range.max - range.min);
  const width = landscape ? longEdge : longEdge * 0.8;
  const height = landscape ? longEdge * 0.8 : longEdge;
  const rotation = (seeded(slotX, slotY, 3) * 2 - 1) * MAX_TILT;
  const cos = Math.abs(Math.cos(rotation));
  const sin = Math.abs(Math.sin(rotation));
  const boxWidth = width * cos + height * sin;
  const boxHeight = height * cos + width * sin;
  const jitterX = Math.max(0, SLOT_WIDTH - boxWidth - SLOT_MARGIN * 2);
  const jitterY = Math.max(0, SLOT_HEIGHT - boxHeight - SLOT_MARGIN * 2);
  const targetX =
    (slotX + 0.5) * SLOT_WIDTH + (seeded(slotX, slotY, 4) - 0.5) * jitterX;
  const targetY =
    (slotY + 0.5) * SLOT_HEIGHT + (seeded(slotX, slotY, 5) - 0.5) * jitterY;
  const pad = stampPadding(landscape) * width;
  const fullWidth = width + pad * 2;
  const fullHeight = height + pad * 2;
  return {
    index,
    tier,
    textureKey: tier === "far" ? index + FAR_TEXTURE_OFFSET : index,
    targetX,
    targetY,
    startX: targetX * 0.08,
    startY: targetY * 0.08,
    width,
    height,
    fullWidth,
    fullHeight,
    insetU: pad / fullWidth,
    insetV: pad / fullHeight,
    rotation,
    opacity: range.opacity,
    renderOrder: range.order,
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
  const camera = new OrthographicCamera(-1, 1, 1, -1, -1000, 5000);
  camera.position.z = 1000;
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const sprites: Sprite[] = [];
  const textureCache = new Map<number, CanvasTexture>();
  const slotList: StampData[] = [];
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
  // Narrow screens start a little zoomed out so the scatter reads like the Paper artboard.
  let zoom = window.innerWidth < 640 ? 0.65 : 1;

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

  const queueTexture = (key: number) => {
    if (textureCache.has(key) || textureQueued.has(key)) return;
    textureQueued.add(key);
    textureQueue.push(key);
    if (!textureQueueRunning) void processTextureQueue();
  };

  const applyTexture = (key: number, texture: CanvasTexture) => {
    textureCache.set(key, texture);
    for (const sprite of sprites) {
      if (sprite.userData.textureKey !== key) continue;
      const material = sprite.material as SpriteMaterial;
      material.map = texture;
      material.needsUpdate = true;
      sprite.visible = true;
    }
  };

  async function processTextureQueue() {
    if (textureQueueRunning || destroyed) return;
    textureQueueRunning = true;
    const started = performance.now();
    while (textureQueue.length && !destroyed) {
      const key = textureQueue.shift()!;
      textureQueued.delete(key);
      const far = key >= FAR_TEXTURE_OFFSET;
      const photo = photos[far ? key - FAR_TEXTURE_OFFSET : key];
      try {
        const canvas = await createStampCanvas(
          { ...photo, fine: coarsePointer ? photo.coarse : photo.fine },
          far ? 200 : coarsePointer ? 360 : 512,
          far,
        );
        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;
        // Premultiplied upload keeps the perforation bites and shadow free of dark fringes.
        texture.premultiplyAlpha = true;
        texture.minFilter = LinearMipmapLinearFilter;
        texture.magFilter = LinearFilter;
        texture.generateMipmaps = true;
        applyTexture(key, texture);
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
    hovered = null;
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
        for (let row = 0; row < CELL_SLOTS; row += 1) {
          for (let column = 0; column < CELL_SLOTS; column += 1) {
            slotList.push(
              stampData(
                photos,
                cellX * CELL_SLOTS + column,
                cellY * CELL_SLOTS + row,
              ),
            );
          }
        }
      }
    }
    // Build the stamps nearest the camera first so their textures are queued first.
    const cameraX = camera.position.x;
    const cameraY = camera.position.y;
    slotList.sort(
      (a, b) =>
        Math.hypot(a.targetX - cameraX, a.targetY - cameraY) -
        Math.hypot(b.targetX - cameraX, b.targetY - cameraY),
    );
    for (const data of slotList) {
      const material = new SpriteMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        fog: false,
        premultipliedAlpha: true,
        rotation: data.rotation,
        opacity: data.opacity,
      });
      // Premultiplied textures need the colour scaled with the opacity.
      material.color.setScalar(data.opacity);
      const sprite = new Sprite(material);
      sprite.position.set(
        introActive ? data.startX : data.targetX,
        introActive ? data.startY : data.targetY,
        0,
      );
      sprite.scale.set(data.fullWidth, data.fullHeight, 1);
      sprite.renderOrder = data.renderOrder;
      sprite.userData = data;
      sprite.visible = false;
      scene.add(sprite);
      sprites.push(sprite);
      const texture = textureCache.get(data.textureKey);
      if (texture) {
        material.map = texture;
        material.needsUpdate = true;
        sprite.visible = true;
      } else {
        queueTexture(data.textureKey);
      }
    }
    slotList.length = 0;
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
    // The sprite quad includes the shadow margin; only the stamp itself counts as a hit.
    for (const hit of raycaster.intersectObjects(sprites, false)) {
      const data = hit.object.userData as StampData;
      const { uv } = hit;
      if (
        uv &&
        uv.x >= data.insetU &&
        uv.x <= 1 - data.insetU &&
        uv.y >= data.insetV &&
        uv.y <= 1 - data.insetV
      )
        return hit.object as Sprite;
    }
    return undefined;
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

  const resetHovered = () => {
    if (!hovered) return;
    const data = hovered.userData as StampData;
    hovered.scale.set(data.fullWidth, data.fullHeight, 1);
    hovered.renderOrder = data.renderOrder;
    hovered = null;
  };

  const updateHover = (event: PointerEvent) => {
    if (!isFinePointer() || dragging || lightboxOpen) return;
    const hit = hitTest(event) ?? null;
    if (hit === hovered) return;
    resetHovered();
    hovered = hit;
    if (!hit) {
      onHoverEnd();
      stage.style.cursor = "grab";
      return;
    }
    const rect = stage.getBoundingClientRect();
    const data = hit.userData as StampData;
    hit.scale.set(data.fullWidth * 1.06, data.fullHeight * 1.06, 1);
    hit.renderOrder = 4;
    const projected = hit.position.clone().project(camera);
    // Bottom-left corner of the lifted, tilted stamp, in stage pixels.
    const halfWidth = (data.width * 1.06 * camera.zoom) / 2;
    const halfHeight = (data.height * 1.06 * camera.zoom) / 2;
    const cos = Math.cos(data.rotation);
    const sin = Math.sin(data.rotation);
    onHover(
      data.index,
      ((projected.x + 1) * rect.width) / 2 - halfWidth * cos + halfHeight * sin,
      ((1 - projected.y) * rect.height) / 2 +
        halfWidth * sin +
        halfHeight * cos +
        8,
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
      resetHovered();
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
        resetHovered();
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
      resetHovered();
      clearSprites();
      for (const texture of textureCache.values()) texture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
