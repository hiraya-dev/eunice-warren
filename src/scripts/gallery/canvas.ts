/*
 * Infinite space, chunking, depth fade and camera movement ported from Edoardo Lunardi's Infinite Canvas (https://github.com/edoardolunardi/infinite-canvas).
 * MIT License, Copyright (c) 2009 - 2025 Codrops (https://codrops.com).
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 * and associated documentation files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 * BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import {
  CanvasTexture,
  Color,
  DoubleSide,
  Fog,
  type Intersection,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import {
  createPolaroidCanvas,
  loadGalleryPhoto,
  polaroidPadding,
} from "./stamp-texture.ts";

export type GalleryCanvasPhoto = {
  index: number;
  fine: string;
  coarse: string;
  width: number;
  height: number;
  orientation: "portrait" | "landscape";
};

export type GallerySourceRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type CanvasOptions = {
  stage: HTMLElement;
  photos: GalleryCanvasPhoto[];
  reducedMotion: boolean;
  onInteraction: () => void;
  onHover: (index: number, x: number, y: number) => void;
  onHoverEnd: () => void;
  onStampClick: (index: number) => void;
  onWebGLFailure: () => void;
};

export type GalleryCanvas = {
  pause: () => void;
  resume: () => void;
  setLightboxOpen: (open: boolean, index?: number) => GallerySourceRect | null;
  destroy: () => void;
};

type PlaneSeed = {
  id: string;
  x: number;
  y: number;
  z: number;
  longEdge: number;
  photoIndex: number;
  rotation: number;
};

type PlaneState = {
  photoIndex: number;
  chunkX: number;
  chunkY: number;
  chunkZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  polaroidWidth: number;
  polaroidHeight: number;
  fullWidth: number;
  fullHeight: number;
  insetU: number;
  insetV: number;
  opacity: number;
  textureReady: boolean;
  hiddenForLightbox: boolean;
  hovered: boolean;
  intro: boolean;
  introDelay: number;
};

type GalleryMesh = Mesh<PlaneGeometry, MeshBasicMaterial> & {
  userData: PlaneState;
};

type ChunkEntry = {
  epoch: number;
  meshes: GalleryMesh[];
};

type PointerPosition = { x: number; y: number };

const CHUNK_SIZE = 110;
const RENDER_DISTANCE = 2;
const CHUNK_FADE_MARGIN = 1;
const PLANES_PER_CHUNK = 5;
const MAX_PLANE_CACHE = 256;
const MAX_VELOCITY = 3.2;
const DEPTH_FADE_START = 140;
const DEPTH_FADE_END = 260;
const DEPTH_HIDE = 310;
const KEYBOARD_SPEED = 0.18;
const VELOCITY_LERP = 0.16;
const VELOCITY_DECAY = 0.9;
const INITIAL_CAMERA_Z = 50;
const MAX_TILT = (8 * Math.PI) / 180;
const INTRO_DURATION = 1200;
const INTRO_SPREAD = 900;
const SETTLED_EPSILON = 0.001;
const LIGHT_COLOR = 0xf5efe3;
const MAX_TEXTURE_CONCURRENCY = 5;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const lerp = (from: number, to: number, amount: number) =>
  from + (to - from) * amount;
const modulo = (value: number, divisor: number) =>
  ((value % divisor) + divisor) % divisor;

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const seededRandom = (seed: number) => {
  let value = seed + 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};

const chunkOffsets = (() => {
  const offsets: Array<{ x: number; y: number; z: number; distance: number }> =
    [];
  const radius = RENDER_DISTANCE + CHUNK_FADE_MARGIN;
  for (let x = -radius; x <= radius; x += 1) {
    for (let y = -radius; y <= radius; y += 1) {
      for (let z = -radius; z <= radius; z += 1) {
        const distance = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
        if (distance <= radius) offsets.push({ x, y, z, distance });
      }
    }
  }
  offsets.sort((left, right) => left.distance - right.distance);
  return offsets;
})();

const planeCache = new Map<string, PlaneSeed[]>();

const generateChunkPlanes = (
  chunkX: number,
  chunkY: number,
  chunkZ: number,
  photoCount: number,
) => {
  const key = `${photoCount}:${chunkX},${chunkY},${chunkZ}`;
  const cached = planeCache.get(key);
  if (cached) {
    planeCache.delete(key);
    planeCache.set(key, cached);
    return cached;
  }

  const planes: PlaneSeed[] = [];
  const seed = hashString(`${chunkX},${chunkY},${chunkZ}`);
  // Face-adjacent chunks move by at least eleven album positions, so their five-photo runs do
  // not repeat. The coprime x stride eventually visits every photo in the album.
  const photoBase = modulo(chunkX * 11 + chunkY * 23 + chunkZ * 41, photoCount);
  const photoRotation = seed % PLANES_PER_CHUNK;
  for (let index = 0; index < PLANES_PER_CHUNK; index += 1) {
    const itemSeed = seed + index * 1000;
    const random = (offset: number) => seededRandom(itemSeed + offset);
    const baseSize = 12 + random(4) * 8;
    planes.push({
      id: `${chunkX}-${chunkY}-${chunkZ}-${index}`,
      x: chunkX * CHUNK_SIZE + random(0) * CHUNK_SIZE,
      y: chunkY * CHUNK_SIZE + random(1) * CHUNK_SIZE,
      z: chunkZ * CHUNK_SIZE + random(2) * CHUNK_SIZE,
      longEdge: baseSize * (0.75 + random(6) * 0.5),
      photoIndex: modulo(
        photoBase + modulo(index + photoRotation, PLANES_PER_CHUNK),
        photoCount,
      ),
      rotation: (random(3) * 2 - 1) * MAX_TILT,
    });
  }

  planeCache.set(key, planes);
  while (planeCache.size > MAX_PLANE_CACHE) {
    const oldest = planeCache.keys().next().value;
    if (typeof oldest !== "string") break;
    planeCache.delete(oldest);
  }
  return planes;
};

const createEase = (x1: number, y1: number, x2: number, y2: number) => {
  const samples = new Float32Array(201);
  const cubic = (time: number, a: number, b: number) => {
    const inverse = 1 - time;
    return (
      3 * inverse * inverse * time * a +
      3 * inverse * time * time * b +
      time ** 3
    );
  };
  for (let index = 0; index < samples.length; index += 1) {
    const x = index / (samples.length - 1);
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const middle = (low + high) / 2;
      if (cubic(middle, x1, x2) < x) low = middle;
      else high = middle;
    }
    samples[index] = cubic((low + high) / 2, y1, y2);
  }
  return (progress: number) => {
    const position = clamp(progress, 0, 1) * (samples.length - 1);
    const lower = Math.floor(position);
    const upper = Math.min(samples.length - 1, lower + 1);
    return lerp(samples[lower], samples[upper], position - lower);
  };
};

const introEase = createEase(0.16, 1, 0.3, 1);
const isFinePointer = () => window.matchMedia("(pointer: fine)").matches;
const textEntryTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.isContentEditable);

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
    onWebGLFailure,
  } = options;
  if (!photos.length) return null;

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
  } catch {
    return null;
  }

  const coarsePointer = !isFinePointer();
  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio || 1, coarsePointer ? 1.25 : 1.5),
  );
  renderer.setClearColor(LIGHT_COLOR, 1);
  renderer.domElement.setAttribute("aria-hidden", "true");
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  stage.replaceChildren(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(LIGHT_COLOR);
  scene.fog = new Fog(LIGHT_COLOR, 120, 320);
  const camera = new PerspectiveCamera(60, 1, 1, 500);
  camera.position.set(0, 0, INITIAL_CAMERA_Z);
  const geometry = new PlaneGeometry(1, 1);
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const projectedCorner = new Vector2();
  const projected = new Vector3();
  const chunks = new Map<string, ChunkEntry>();
  const meshesByPhoto = new Map<number, Set<GalleryMesh>>();
  const textureCache = new Map<number, CanvasTexture>();
  const textureQueue: number[] = [];
  const textureQueued = new Set<number>();
  const textureInFlight = new Set<number>();
  const failedTextures = new Set<number>();
  const pointers = new Map<number, PointerPosition>();
  const heldKeys = new Set<string>();
  const rayHits: Intersection<GalleryMesh>[] = [];

  let meshes: GalleryMesh[] = [];
  let destroyed = false;
  let running = true;
  let lightboxOpen = false;
  let windowListenersBound = false;
  let frame = 0;
  let textureSchedule = 0;
  let textureActiveCount = 0;
  const textureDrawQueue: Array<{
    index: number;
    image: HTMLImageElement;
  }> = [];
  const galleryTestWindow = window as Window & {
    __galleryTextureRequests?: number[];
    __galleryTexturePriorities?: Record<string, number>;
  };
  let chunkEpoch = 0;
  let observedChunkX = Number.NaN;
  let observedChunkY = Number.NaN;
  let observedChunkZ = Number.NaN;
  let lastChunkUpdate = 0;
  let pendingChunkX = 0;
  let pendingChunkY = 0;
  let pendingChunkZ = 0;
  let hasPendingChunk = true;
  let currentChunkX = 0;
  let currentChunkY = 0;
  let currentChunkZ = 0;
  let introStart = performance.now();
  let introEnabled = !reducedMotion;
  let hovered: GalleryMesh | null = null;
  let hiddenMesh: GalleryMesh | null = null;
  let lastClickedMesh: GalleryMesh | null = null;
  let dragging = false;
  let moved = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let lastX = 0;
  let lastY = 0;
  let lastPinchDistance = 0;
  let pointerActive = false;
  let hoverDirty = false;
  let baseX = 0;
  let baseY = 0;
  let baseZ = INITIAL_CAMERA_Z;
  let driftX = 0;
  let driftY = 0;
  let mouseX = 0;
  let mouseY = 0;
  let velocityX = 0;
  let velocityY = 0;
  let velocityZ = 0;
  let targetVelocityX = 0;
  let targetVelocityY = 0;
  let targetVelocityZ = 0;
  let scrollAccum = 0;
  let viewportLeft = 0;
  let viewportTop = 0;
  let viewportWidth = 1;
  let viewportHeight = 1;

  const resize = () => {
    if (!running) return;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setSize(rect.width, rect.height, false);
    viewportLeft = rect.left;
    viewportTop = rect.top;
    viewportWidth = rect.width;
    viewportHeight = rect.height;
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  };

  const scheduleTextureDraw = () => {
    if (destroyed || textureSchedule || !textureDrawQueue.length) return;
    const idleWindow = window as unknown as {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
    };
    if (idleWindow.requestIdleCallback) {
      textureSchedule = idleWindow.requestIdleCallback(
        () => {
          textureSchedule = 0;
          const item = textureDrawQueue.shift();
          if (item) void drawTexture(item.index, item.image);
          scheduleTextureDraw();
        },
        { timeout: 100 },
      );
    } else {
      textureSchedule = window.setTimeout(() => {
        textureSchedule = 0;
        const item = textureDrawQueue.shift();
        if (item) void drawTexture(item.index, item.image);
        scheduleTextureDraw();
      }, 0);
    }
  };

  const texturePriority = (index: number) => {
    let priority = Number.POSITIVE_INFINITY;
    for (const mesh of meshesByPhoto.get(index) ?? []) {
      const data = mesh.userData;
      projected.set(data.targetX, data.targetY, data.targetZ).project(camera);
      const screenDistance = Math.hypot(projected.x, projected.y);
      const depthDistance = Math.abs(camera.position.z - data.targetZ) / DEPTH_HIDE;
      priority = Math.min(priority, screenDistance + depthDistance * 0.35);
    }
    return priority;
  };

  const reprioritizeTextureQueue = () => {
    if (galleryTestWindow.__galleryTexturePriorities) {
      for (const index of textureQueue)
        galleryTestWindow.__galleryTexturePriorities[index] = texturePriority(index);
    }
    textureQueue.sort((left, right) => texturePriority(left) - texturePriority(right));
  };

  const pumpTextureQueue = () => {
    if (destroyed) return;
    reprioritizeTextureQueue();
    while (textureActiveCount < MAX_TEXTURE_CONCURRENCY && textureQueue.length) {
      const index = textureQueue.shift();
      if (index === undefined) break;
      textureQueued.delete(index);
      textureInFlight.add(index);
      textureActiveCount += 1;
      void loadTexture(index);
    }
  };

  const queueTexture = (index: number) => {
    if (
      textureCache.has(index) ||
      textureQueued.has(index) ||
      textureInFlight.has(index) ||
      failedTextures.has(index)
    )
      return;
    textureQueued.add(index);
    textureQueue.push(index);
  };

  const wake = () => {
    if (!frame && running && !destroyed && !lightboxOpen)
      frame = requestAnimationFrame(render);
  };

  const applyTexture = (index: number, texture: CanvasTexture) => {
    textureCache.set(index, texture);
    const photoMeshes = meshesByPhoto.get(index);
    if (photoMeshes) {
      for (const mesh of photoMeshes) {
        mesh.material.map = texture;
        mesh.material.needsUpdate = true;
        mesh.userData.textureReady = true;
      }
    }
    wake();
  };

  async function drawTexture(index: number, image: HTMLImageElement) {
    const photo = photos[index];
    try {
      const canvas = await createPolaroidCanvas(
        {
          ...photo,
          fine: coarsePointer ? photo.coarse : photo.fine,
        },
        coarsePointer ? 360 : 512,
        false,
        image,
      );
      if (destroyed) return;
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      texture.premultiplyAlpha = true;
      texture.minFilter = LinearMipmapLinearFilter;
      texture.magFilter = LinearFilter;
      texture.generateMipmaps = true;
      applyTexture(index, texture);
    } catch {
      failedTextures.add(index);
    } finally {
      textureInFlight.delete(index);
      textureActiveCount -= 1;
      pumpTextureQueue();
    }
  }

  async function loadTexture(index: number) {
    const photo = photos[index];
    galleryTestWindow.__galleryTextureRequests?.push(index);
    try {
      const image = await loadGalleryPhoto(
        coarsePointer ? photo.coarse : photo.fine,
      );
      if (destroyed) return;
      textureDrawQueue.push({ index, image });
      scheduleTextureDraw();
    } catch {
      failedTextures.add(index);
      textureInFlight.delete(index);
      textureActiveCount -= 1;
      pumpTextureQueue();
    }
  }

  const introDelayFor = (x: number, y: number, z: number) => {
    projected.set(x, y, z).project(camera);
    return (
      clamp(Math.hypot(projected.x, projected.y) / Math.SQRT2, 0, 1) *
      INTRO_SPREAD
    );
  };

  const createMesh = (
    plane: PlaneSeed,
    chunkX: number,
    chunkY: number,
    chunkZ: number,
    useIntro: boolean,
  ) => {
    const photo = photos[plane.photoIndex];
    const landscape = photo.orientation === "landscape";
    const polaroidWidth = landscape ? plane.longEdge : plane.longEdge * 0.8;
    const polaroidHeight = landscape ? plane.longEdge * 0.8 : plane.longEdge;
    const padding = polaroidPadding(landscape) * polaroidWidth;
    const fullWidth = polaroidWidth + padding * 2;
    const fullHeight = polaroidHeight + padding * 2;
    const material = new MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthTest: true,
      depthWrite: false,
      fog: true,
      premultipliedAlpha: true,
      side: DoubleSide,
    });
    const mesh = new Mesh(geometry, material) as GalleryMesh;
    const texture = textureCache.get(plane.photoIndex);
    const intro = useIntro && !reducedMotion;
    mesh.userData = {
      photoIndex: plane.photoIndex,
      chunkX,
      chunkY,
      chunkZ,
      targetX: plane.x,
      targetY: plane.y,
      targetZ: plane.z,
      polaroidWidth,
      polaroidHeight,
      fullWidth,
      fullHeight,
      insetU: padding / fullWidth,
      insetV: padding / fullHeight,
      opacity: 0,
      textureReady: Boolean(texture),
      hiddenForLightbox: false,
      hovered: false,
      intro,
      introDelay: intro ? introDelayFor(plane.x, plane.y, plane.z) : 0,
    };
    mesh.position.set(
      intro ? camera.position.x : plane.x,
      intro ? camera.position.y : plane.y,
      plane.z,
    );
    mesh.rotation.z = plane.rotation;
    mesh.scale.set(
      fullWidth * (intro ? 0.82 : 1),
      fullHeight * (intro ? 0.82 : 1),
      1,
    );
    mesh.visible = false;
    if (texture) material.map = texture;
    scene.add(mesh);
    let photoMeshes = meshesByPhoto.get(plane.photoIndex);
    if (!photoMeshes) {
      photoMeshes = new Set();
      meshesByPhoto.set(plane.photoIndex, photoMeshes);
    }
    photoMeshes.add(mesh);
    queueTexture(plane.photoIndex);
    return mesh;
  };

  const disposeChunk = (entry: ChunkEntry) => {
    for (const mesh of entry.meshes) {
      if (mesh === hovered) hovered = null;
      if (mesh === hiddenMesh) hiddenMesh = null;
      if (mesh === lastClickedMesh) lastClickedMesh = null;
      scene.remove(mesh);
      mesh.material.dispose();
      const photoMeshes = meshesByPhoto.get(mesh.userData.photoIndex);
      photoMeshes?.delete(mesh);
      if (!photoMeshes?.size) meshesByPhoto.delete(mesh.userData.photoIndex);
    }
  };

  const syncChunks = (
    centerX: number,
    centerY: number,
    centerZ: number,
    useIntro = false,
  ) => {
    chunkEpoch += 1;
    for (const offset of chunkOffsets) {
      const chunkX = centerX + offset.x;
      const chunkY = centerY + offset.y;
      const chunkZ = centerZ + offset.z;
      const key = `${chunkX},${chunkY},${chunkZ}`;
      const existing = chunks.get(key);
      if (existing) {
        existing.epoch = chunkEpoch;
        continue;
      }
      const entry: ChunkEntry = { epoch: chunkEpoch, meshes: [] };
      for (const plane of generateChunkPlanes(
        chunkX,
        chunkY,
        chunkZ,
        photos.length,
      )) {
        entry.meshes.push(createMesh(plane, chunkX, chunkY, chunkZ, useIntro));
      }
      chunks.set(key, entry);
    }

    for (const [key, entry] of chunks) {
      if (entry.epoch === chunkEpoch) continue;
      disposeChunk(entry);
      chunks.delete(key);
    }
    meshes.length = 0;
    for (const entry of chunks.values()) meshes.push(...entry.meshes);
    reprioritizeTextureQueue();
    pumpTextureQueue();
    onHoverEnd();
  };

  const setIntro = () => {
    if (reducedMotion) {
      introEnabled = false;
      return;
    }
    introEnabled = true;
    introStart = performance.now();
    camera.updateMatrixWorld(true);
    for (const mesh of meshes) {
      const data = mesh.userData;
      data.intro = true;
      data.introDelay = introDelayFor(data.targetX, data.targetY, data.targetZ);
      mesh.position.x = camera.position.x;
      mesh.position.y = camera.position.y;
      mesh.scale.set(data.fullWidth * 0.82, data.fullHeight * 0.82, 1);
      data.opacity = 0;
      mesh.material.opacity = 0;
      mesh.visible = false;
    }
  };

  const keyAction = (key: string) => {
    const normalized = key.length === 1 ? key.toLowerCase() : key;
    if (normalized === "w" || normalized === "ArrowUp") return "forward";
    if (normalized === "s" || normalized === "ArrowDown") return "backward";
    if (normalized === "a" || normalized === "ArrowLeft") return "left";
    if (normalized === "d" || normalized === "ArrowRight") return "right";
    if (normalized === "e") return "up";
    if (normalized === "q") return "down";
    return null;
  };

  const applyHeldKeys = () => {
    for (const key of heldKeys) {
      const action = keyAction(key);
      if (action === "forward") targetVelocityZ -= KEYBOARD_SPEED;
      else if (action === "backward") targetVelocityZ += KEYBOARD_SPEED;
      else if (action === "left") targetVelocityX -= KEYBOARD_SPEED;
      else if (action === "right") targetVelocityX += KEYBOARD_SPEED;
      else if (action === "up") targetVelocityY += KEYBOARD_SPEED;
      else if (action === "down") targetVelocityY -= KEYBOARD_SPEED;
    }
  };

  const updateIntro = (mesh: GalleryMesh, now: number) => {
    const data = mesh.userData;
    if (!data.intro) return 1;
    const progress = clamp(
      (now - introStart - data.introDelay) / INTRO_DURATION,
      0,
      1,
    );
    const eased = introEase(progress);
    mesh.position.x = lerp(camera.position.x, data.targetX, eased);
    mesh.position.y = lerp(camera.position.y, data.targetY, eased);
    const scale = lerp(0.82, 1, eased) * (data.hovered ? 1.06 : 1);
    mesh.scale.set(data.fullWidth * scale, data.fullHeight * scale, 1);
    if (progress >= 1) {
      data.intro = false;
      mesh.position.x = data.targetX;
      mesh.position.y = data.targetY;
    }
    return eased;
  };

  const updatePlanes = (now: number) => {
    let unsettled = false;
    const focalPixels =
      viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    for (const mesh of meshes) {
      const data = mesh.userData;
      const introOpacity = updateIntro(mesh, now);
      if (data.intro) unsettled = true;
      if (data.hiddenForLightbox) {
        mesh.material.opacity = 0;
        mesh.material.depthWrite = false;
        mesh.visible = false;
        continue;
      }

      const depth = camera.position.z - mesh.position.z;
      const chunkDistance = Math.max(
        Math.abs(data.chunkX - currentChunkX),
        Math.abs(data.chunkY - currentChunkY),
        Math.abs(data.chunkZ - currentChunkZ),
      );
      let targetOpacity = 0;
      if (depth > 0 && depth <= DEPTH_HIDE && data.textureReady) {
        const chunkFade =
          chunkDistance <= RENDER_DISTANCE
            ? 1
            : clamp(
                1 - (chunkDistance - RENDER_DISTANCE) / CHUNK_FADE_MARGIN,
                0,
                1,
              );
        const depthFade =
          depth <= DEPTH_FADE_START
            ? 1
            : clamp(
                1 -
                  (depth - DEPTH_FADE_START) /
                    (DEPTH_FADE_END - DEPTH_FADE_START),
                0,
                1,
              );
        const projectedHeight =
          ((data.polaroidHeight / data.fullHeight) * mesh.scale.y * focalPixels) /
          depth;
        const nearRatio = projectedHeight / viewportHeight;
        const nearFade =
          nearRatio <= 0.55 ? 1 : clamp(1 - (nearRatio - 0.55) / 0.3, 0, 1);
        targetOpacity = Math.min(chunkFade, depthFade, nearFade) * introOpacity;
      }

      const nextOpacity =
        targetOpacity < 0.01 && data.opacity < 0.01
          ? 0
          : lerp(data.opacity, targetOpacity, 0.18);
      if (Math.abs(nextOpacity - targetOpacity) > SETTLED_EPSILON)
        unsettled = true;
      data.opacity = nextOpacity;
      const opaque = nextOpacity > 0.99;
      mesh.material.opacity = opaque ? 1 : nextOpacity;
      mesh.material.depthWrite = opaque;
      mesh.visible = data.textureReady && nextOpacity > 0.01;
    }
    if (introEnabled && now >= introStart + INTRO_DURATION + INTRO_SPREAD)
      introEnabled = false;
    return unsettled || introEnabled;
  };

  const projectCorner = (
    mesh: GalleryMesh,
    localX: number,
    localY: number,
  ) => {
    const cosine = Math.cos(mesh.rotation.z);
    const sine = Math.sin(mesh.rotation.z);
    projected
      .set(
        mesh.position.x + localX * cosine - localY * sine,
        mesh.position.y + localX * sine + localY * cosine,
        mesh.position.z,
      )
      .project(camera);
    return projectedCorner.set(
      viewportLeft + ((projected.x + 1) * viewportWidth) / 2,
      viewportTop + ((1 - projected.y) * viewportHeight) / 2,
    );
  };

  const screenRect = (mesh: GalleryMesh): GallerySourceRect | null => {
    const depth = camera.position.z - mesh.position.z;
    if (depth <= 0) return null;
    const data = mesh.userData;
    const scaleFactor = mesh.scale.x / data.fullWidth;
    const halfWidth = (data.polaroidWidth * scaleFactor) / 2;
    const halfHeight = (data.polaroidHeight * scaleFactor) / 2;
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const x of [-halfWidth, halfWidth]) {
      for (const y of [-halfHeight, halfHeight]) {
        const point = projectCorner(mesh, x, y);
        left = Math.min(left, point.x);
        top = Math.min(top, point.y);
        right = Math.max(right, point.x);
        bottom = Math.max(bottom, point.y);
      }
    }
    return { left, top, width: right - left, height: bottom - top };
  };

  const visiblePhotoMesh = (index: number) => {
    const candidates = meshesByPhoto.get(index);
    if (!candidates) return null;
    let best: GalleryMesh | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const mesh of candidates) {
      if (
        !mesh.visible ||
        mesh.userData.opacity <= 0.3 ||
        mesh.userData.hiddenForLightbox
      )
        continue;
      const rect = screenRect(mesh);
      if (
        !rect ||
        rect.left + rect.width < 0 ||
        rect.top + rect.height < 0 ||
        rect.left > window.innerWidth ||
        rect.top > window.innerHeight
      )
        continue;
      const distance = Math.hypot(
        rect.left + rect.width / 2 - window.innerWidth / 2,
        rect.top + rect.height / 2 - window.innerHeight / 2,
      );
      if (distance < bestDistance) {
        best = mesh;
        bestDistance = distance;
      }
    }
    return best;
  };

  const restoreHiddenMesh = () => {
    if (!hiddenMesh) return;
    if (hiddenMesh.parent !== scene) {
      hiddenMesh = null;
      return;
    }
    const data = hiddenMesh.userData;
    data.hiddenForLightbox = false;
    hiddenMesh.material.opacity = data.opacity;
    hiddenMesh.visible = data.textureReady && data.opacity > 0.01;
    hiddenMesh = null;
  };

  const resetHovered = () => {
    if (!hovered) return;
    const data = hovered.userData;
    data.hovered = false;
    hovered.scale.set(data.fullWidth, data.fullHeight, 1);
    hovered.material.depthTest = true;
    hovered.renderOrder = 0;
    hovered = null;
  };

  const findHit = () => {
    raycaster.setFromCamera(pointer, camera);
    rayHits.length = 0;
    raycaster.intersectObjects(meshes, false, rayHits);
    for (const hit of rayHits) {
      const mesh = hit.object;
      const data = mesh.userData;
      if (
        data.opacity <= 0.3 ||
        data.hiddenForLightbox ||
        !hit.uv ||
        hit.uv.x < data.insetU ||
        hit.uv.x > 1 - data.insetU ||
        hit.uv.y < data.insetV ||
        hit.uv.y > 1 - data.insetV
      )
        continue;
      return mesh;
    }
    return null;
  };

  const processHover = () => {
    hoverDirty = false;
    if (coarsePointer || dragging || lightboxOpen) return;
    if (!pointerActive) {
      resetHovered();
      onHoverEnd();
      stage.style.cursor = "grab";
      return;
    }
    const hit = findHit();
    if (hit !== hovered) {
      resetHovered();
      hovered = hit;
      if (hit) {
        const data = hit.userData;
        data.hovered = true;
        hit.scale.set(data.fullWidth * 1.06, data.fullHeight * 1.06, 1);
        hit.material.depthTest = false;
        hit.renderOrder = 10;
      }
    }
    if (!hit) {
      onHoverEnd();
      stage.style.cursor = "grab";
      return;
    }
    const data = hit.userData;
    const bottomLeft = projectCorner(
      hit,
      (-data.polaroidWidth * 1.06) / 2,
      (-data.polaroidHeight * 1.06) / 2,
    );
    onHover(
      data.photoIndex,
      bottomLeft.x - viewportLeft,
      bottomLeft.y - viewportTop + 8,
    );
    stage.style.cursor = "pointer";
  };

  function render() {
    frame = 0;
    if (destroyed || !running || lightboxOpen) return;
    const now = performance.now();
    applyHeldKeys();

    const zooming = Math.abs(velocityZ) > 0.05;
    let driftMoving = false;
    if (reducedMotion) {
      driftX = 0;
      driftY = 0;
    } else if (!dragging) {
      const zoomFactor = clamp(baseZ / 50, 0.3, 2);
      const amount = coarsePointer ? 0 : 8 * zoomFactor;
      const driftLerp = zooming ? 0.2 : 0.12;
      const nextDriftX = lerp(driftX, mouseX * amount, driftLerp);
      const nextDriftY = lerp(driftY, mouseY * amount, driftLerp);
      driftMoving =
        Math.abs(nextDriftX - driftX) > SETTLED_EPSILON ||
        Math.abs(nextDriftY - driftY) > SETTLED_EPSILON;
      driftX = driftMoving ? nextDriftX : mouseX * amount;
      driftY = driftMoving ? nextDriftY : mouseY * amount;
    }

    targetVelocityZ += scrollAccum;
    scrollAccum = reducedMotion ? 0 : scrollAccum * 0.8;
    targetVelocityX = clamp(targetVelocityX, -MAX_VELOCITY, MAX_VELOCITY);
    targetVelocityY = clamp(targetVelocityY, -MAX_VELOCITY, MAX_VELOCITY);
    targetVelocityZ = clamp(targetVelocityZ, -MAX_VELOCITY, MAX_VELOCITY);

    if (reducedMotion) {
      velocityX = targetVelocityX;
      velocityY = targetVelocityY;
      velocityZ = targetVelocityZ;
      targetVelocityX = 0;
      targetVelocityY = 0;
      targetVelocityZ = 0;
    } else {
      velocityX = lerp(velocityX, targetVelocityX, VELOCITY_LERP);
      velocityY = lerp(velocityY, targetVelocityY, VELOCITY_LERP);
      velocityZ = lerp(velocityZ, targetVelocityZ, VELOCITY_LERP);
      targetVelocityX *= VELOCITY_DECAY;
      targetVelocityY *= VELOCITY_DECAY;
      targetVelocityZ *= VELOCITY_DECAY;
    }

    baseX += velocityX;
    baseY += velocityY;
    baseZ += velocityZ;
    const cameraX = baseX + driftX;
    const cameraY = baseY + driftY;
    const cameraMoved =
      Math.abs(camera.position.x - cameraX) > SETTLED_EPSILON ||
      Math.abs(camera.position.y - cameraY) > SETTLED_EPSILON ||
      Math.abs(camera.position.z - baseZ) > SETTLED_EPSILON;
    camera.position.set(cameraX, cameraY, baseZ);
    camera.updateMatrixWorld(true);
    if (cameraMoved && pointerActive) hoverDirty = true;
    currentChunkX = Math.floor(baseX / CHUNK_SIZE);
    currentChunkY = Math.floor(baseY / CHUNK_SIZE);
    currentChunkZ = Math.floor(baseZ / CHUNK_SIZE);
    if (
      currentChunkX !== observedChunkX ||
      currentChunkY !== observedChunkY ||
      currentChunkZ !== observedChunkZ
    ) {
      observedChunkX = currentChunkX;
      observedChunkY = currentChunkY;
      observedChunkZ = currentChunkZ;
      pendingChunkX = currentChunkX;
      pendingChunkY = currentChunkY;
      pendingChunkZ = currentChunkZ;
      hasPendingChunk = true;
    }
    const throttle = Math.abs(velocityZ) > 1 ? 500 : zooming ? 400 : 100;
    if (hasPendingChunk && now - lastChunkUpdate >= throttle) {
      syncChunks(pendingChunkX, pendingChunkY, pendingChunkZ);
      hasPendingChunk = false;
      lastChunkUpdate = now;
    }

    const planesMoving = updatePlanes(now);
    if (hoverDirty) processHover();
    renderer.render(scene, camera);

    if (
      !reducedMotion &&
      Math.abs(targetVelocityX) < SETTLED_EPSILON &&
      Math.abs(targetVelocityY) < SETTLED_EPSILON &&
      Math.abs(targetVelocityZ) < SETTLED_EPSILON &&
      Math.abs(scrollAccum) < SETTLED_EPSILON
    ) {
      targetVelocityX = 0;
      targetVelocityY = 0;
      targetVelocityZ = 0;
      scrollAccum = 0;
      if (Math.abs(velocityX) < SETTLED_EPSILON) velocityX = 0;
      if (Math.abs(velocityY) < SETTLED_EPSILON) velocityY = 0;
      if (Math.abs(velocityZ) < SETTLED_EPSILON) velocityZ = 0;
    }
    const moving =
      dragging ||
      heldKeys.size > 0 ||
      velocityX !== 0 ||
      velocityY !== 0 ||
      velocityZ !== 0 ||
      targetVelocityX !== 0 ||
      targetVelocityY !== 0 ||
      targetVelocityZ !== 0 ||
      scrollAccum !== 0 ||
      driftMoving ||
      planesMoving ||
      hasPendingChunk ||
      hoverDirty;
    if (moving) frame = requestAnimationFrame(render);
  }

  const setPointer = (event: PointerEvent) => {
    const rect = stage.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    mouseX = pointer.x;
    mouseY = pointer.y;
    pointerActive = true;
  };

  const resetMovement = () => {
    velocityX = 0;
    velocityY = 0;
    velocityZ = 0;
    targetVelocityX = 0;
    targetVelocityY = 0;
    targetVelocityZ = 0;
    scrollAccum = 0;
    heldKeys.clear();
  };

  const resetGesture = () => {
    for (const pointerId of pointers.keys()) {
      if (stage.hasPointerCapture?.(pointerId))
        stage.releasePointerCapture?.(pointerId);
    }
    pointers.clear();
    dragging = false;
    moved = false;
    lastPinchDistance = 0;
    stage.style.cursor = "grab";
  };

  const pinchDistance = () => {
    let first: PointerPosition | undefined;
    let second: PointerPosition | undefined;
    for (const position of pointers.values()) {
      if (!first) first = position;
      else {
        second = position;
        break;
      }
    }
    return first && second
      ? Math.hypot(first.x - second.x, first.y - second.y)
      : 0;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (lightboxOpen) return;
    setPointer(event);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    stage.setPointerCapture?.(event.pointerId);
    if (pointers.size === 2) {
      lastPinchDistance = pinchDistance();
      moved = true;
      dragging = false;
      return;
    }
    dragging = true;
    resetHovered();
    onHoverEnd();
    moved = false;
    dragStartX = lastX = event.clientX;
    dragStartY = lastY = event.clientY;
    stage.style.cursor = "grabbing";
    wake();
  };

  const onPointerMove = (event: PointerEvent) => {
    setPointer(event);
    const previous = pointers.get(event.pointerId);
    if (!previous) {
      hoverDirty = true;
      wake();
      return;
    }
    previous.x = event.clientX;
    previous.y = event.clientY;
    if (pointers.size >= 2) {
      const distance = pinchDistance();
      if (lastPinchDistance)
        scrollAccum += (lastPinchDistance - distance) * 0.006;
      lastPinchDistance = distance;
      moved = true;
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
    const factor = event.pointerType === "touch" ? 0.02 : 0.025;
    targetVelocityX -= deltaX * factor;
    targetVelocityY += deltaY * factor;
    onInteraction();
    wake();
  };

  const onPointerUp = (event: PointerEvent) => {
    const tracked = pointers.has(event.pointerId);
    pointers.delete(event.pointerId);
    if (stage.hasPointerCapture?.(event.pointerId))
      stage.releasePointerCapture?.(event.pointerId);
    if (pointers.size) {
      const remaining = pointers.values().next().value as
        PointerPosition | undefined;
      if (remaining) {
        lastX = remaining.x;
        lastY = remaining.y;
      }
      lastPinchDistance = 0;
      dragging = pointers.size === 1;
      return;
    }
    const wasDrag = moved;
    dragging = false;
    moved = false;
    lastPinchDistance = 0;
    stage.style.cursor = "grab";
    if (tracked && !wasDrag) {
      setPointer(event);
      const hit = findHit();
      if (hit && screenRect(hit)) {
        lastClickedMesh = hit;
        onStampClick(hit.userData.photoIndex);
      }
    }
    wake();
  };

  const onPointerCancel = () => {
    resetGesture();
    resetMovement();
  };

  const onPointerLeave = () => {
    if (dragging) return;
    pointerActive = false;
    mouseX = 0;
    mouseY = 0;
    hoverDirty = true;
    wake();
  };

  const onWheel = (event: WheelEvent) => {
    if (lightboxOpen) return;
    event.preventDefault();
    scrollAccum += event.deltaY * 0.006;
    onInteraction();
    wake();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (
      lightboxOpen ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      textEntryTarget(event.target) ||
      !keyAction(event.key)
    )
      return;
    event.preventDefault();
    heldKeys.add(event.key.length === 1 ? event.key.toLowerCase() : event.key);
    onInteraction();
    wake();
  };

  const onKeyUp = (event: KeyboardEvent) => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (!keyAction(key)) return;
    heldKeys.delete(key);
    wake();
  };

  const onResize = () => {
    resize();
    hoverDirty = true;
    wake();
  };

  const resetTransientInput = () => {
    resetGesture();
    resetMovement();
    pointerActive = false;
    resetHovered();
    onHoverEnd();
    wake();
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") resetTransientInput();
  };

  const bindWindowListeners = () => {
    if (windowListenersBound) return;
    windowListenersBound = true;
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", resetTransientInput);
    document.addEventListener("visibilitychange", onVisibilityChange);
  };

  const unbindWindowListeners = () => {
    if (!windowListenersBound) return;
    windowListenersBound = false;
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("blur", resetTransientInput);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };

  const onContextLost = (event: Event) => {
    event.preventDefault();
    onWebGLFailure();
  };

  resize();
  currentChunkX = Math.floor(baseX / CHUNK_SIZE);
  currentChunkY = Math.floor(baseY / CHUNK_SIZE);
  currentChunkZ = Math.floor(baseZ / CHUNK_SIZE);
  observedChunkX = currentChunkX;
  observedChunkY = currentChunkY;
  observedChunkZ = currentChunkZ;
  camera.updateMatrixWorld(true);
  syncChunks(currentChunkX, currentChunkY, currentChunkZ, !reducedMotion);
  hasPendingChunk = false;
  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("pointermove", onPointerMove);
  stage.addEventListener("pointerup", onPointerUp);
  stage.addEventListener("pointercancel", onPointerCancel);
  stage.addEventListener("pointerleave", onPointerLeave);
  stage.addEventListener("wheel", onWheel, { passive: false });
  renderer.domElement.addEventListener("webglcontextlost", onContextLost);
  bindWindowListeners();
  wake();

  return {
    pause() {
      running = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      unbindWindowListeners();
      resetGesture();
      resetMovement();
      resetHovered();
      restoreHiddenMesh();
      lightboxOpen = false;
      onHoverEnd();
    },
    resume() {
      running = true;
      resize();
      bindWindowListeners();
      setIntro();
      wake();
    },
    setLightboxOpen(open, index) {
      if (open) {
        const wasLightboxOpen = lightboxOpen;
        lightboxOpen = true;
        resetGesture();
        resetMovement();
        camera.updateMatrixWorld(true);
        if (hiddenMesh && hiddenMesh.parent !== scene) hiddenMesh = null;
        if (lastClickedMesh && lastClickedMesh.parent !== scene)
          lastClickedMesh = null;
        const source =
          hiddenMesh?.userData.photoIndex === index
            ? hiddenMesh
            : lastClickedMesh?.userData.photoIndex === index
              ? lastClickedMesh
              : !wasLightboxOpen || index === undefined
                ? null
                : visiblePhotoMesh(index);
        const rect = source ? screenRect(source) : null;
        resetHovered();
        restoreHiddenMesh();
        hiddenMesh = source;
        if (hiddenMesh) {
          hiddenMesh.userData.hiddenForLightbox = true;
          hiddenMesh.material.opacity = 0;
          hiddenMesh.material.depthWrite = false;
          hiddenMesh.visible = false;
        }
        lastClickedMesh = null;
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        renderer.render(scene, camera);
        onHoverEnd();
        return rect;
      }

      restoreHiddenMesh();
      lightboxOpen = false;
      renderer.render(scene, camera);
      wake();
      return null;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      running = false;
      if (frame) cancelAnimationFrame(frame);
      if (textureSchedule) {
        const idleWindow = window as unknown as {
          cancelIdleCallback?: (handle: number) => void;
        };
        if (idleWindow.cancelIdleCallback)
          idleWindow.cancelIdleCallback(textureSchedule);
        else globalThis.clearTimeout(textureSchedule);
      }
      textureDrawQueue.length = 0;
      textureQueue.length = 0;
      textureQueued.clear();
      textureInFlight.clear();
      textureActiveCount = 0;
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", onPointerUp);
      stage.removeEventListener("pointercancel", onPointerCancel);
      stage.removeEventListener("pointerleave", onPointerLeave);
      stage.removeEventListener("wheel", onWheel);
      unbindWindowListeners();
      resetGesture();
      resetHovered();
      for (const entry of chunks.values()) disposeChunk(entry);
      chunks.clear();
      meshes.length = 0;
      for (const texture of textureCache.values()) texture.dispose();
      textureCache.clear();
      geometry.dispose();
      renderer.domElement.removeEventListener(
        "webglcontextlost",
        onContextLost,
      );
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
