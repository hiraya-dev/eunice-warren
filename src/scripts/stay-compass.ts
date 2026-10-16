const REST_ANGLE = 22;
const TOUCH_START_ANGLE = 300;
const SPRING_STIFFNESS = 150;
const SPRING_DAMPING = 18;
const ANGLE_EPSILON = 0.08;
const VELOCITY_EPSILON = 0.08;

let initialized = false;
let cleanups: (() => void)[] = [];

const normalize = (angle: number) => ((angle % 360) + 360) % 360;

const shortestDelta = (from: number, to: number) =>
  normalize(to - from + 180) - 180;

function cleanup() {
  cleanups.forEach((dispose) => dispose());
  cleanups = [];
  initialized = false;
}

export function initStayCompass() {
  if (initialized) return;

  const stay = document.querySelector<HTMLElement>("#stay");
  const compass = stay?.querySelector<SVGSVGElement>(".stay_compass");
  const needle = stay?.querySelector<SVGGElement>(".stay_compass-needle");
  const heart = stay?.querySelector<SVGPathElement>(".stay_compass-heart");
  if (!stay || !compass || !needle || !heart) return;

  initialized = true;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

  if (reducedMotion.matches) {
    needle.dataset.angle = String(REST_ANGLE);
    document.addEventListener("astro:before-swap", cleanup, { once: true });
    return;
  }

  let inView = false;
  let pointerInside = false;
  let hasEnteredTouchMotion = false;
  let returnPending = false;
  let rafId: number | null = null;
  let lastTime = 0;
  let current = REST_ANGLE;
  let target = REST_ANGLE;
  let velocity = 0;
  let compassRect = compass.getBoundingClientRect();

  const refreshRect = () => {
    compassRect = compass.getBoundingClientRect();
  };

  const setNeedle = (angle: number) => {
    needle.style.transform = `rotate(${angle - REST_ANGLE}deg)`;
    needle.dataset.angle = String(Math.round(normalize(angle) * 100) / 100);
  };

  const pulseHeart = () => {
    heart.classList.remove("is-pulsing");
    void heart.getBoundingClientRect();
    heart.classList.add("is-pulsing");
  };

  const stopFrame = () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    lastTime = 0;
  };

  const frame = (time: number) => {
    rafId = null;
    if (!inView) return;
    const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.032) : 1 / 60;
    lastTime = time;

    const acceleration = (target - current) * SPRING_STIFFNESS;
    velocity += acceleration * dt;
    velocity *= Math.exp(-SPRING_DAMPING * dt);
    current += velocity * dt;
    setNeedle(current);

    const error = target - current;
    if (Math.abs(error) < ANGLE_EPSILON && Math.abs(velocity) < VELOCITY_EPSILON) {
      current = target;
      velocity = 0;
      setNeedle(current);
      if (returnPending && Math.abs(shortestDelta(current, REST_ANGLE)) < 3) {
        returnPending = false;
        pulseHeart();
      }
      return;
    }

    rafId = requestAnimationFrame(frame);
  };

  const startFrame = () => {
    if (rafId === null && inView) rafId = requestAnimationFrame(frame);
  };

  const setTarget = (next: number) => {
    target = current + shortestDelta(current, next);
    startFrame();
  };

  const onPointerEnter = () => {
    pointerInside = true;
    refreshRect();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || !finePointer.matches || !inView) return;
    if (!pointerInside) onPointerEnter();
    const centerX = compassRect.left + compassRect.width * (230 / 460);
    const centerY = compassRect.top + compassRect.height * (240 / 480);
    const next = normalize((Math.atan2(event.clientX - centerX, centerY - event.clientY) * 180) / Math.PI);
    if (Math.abs(shortestDelta(current, next)) > 3) returnPending = false;
    setTarget(next);
  };

  const onPointerLeave = () => {
    if (!pointerInside) return;
    pointerInside = false;
    returnPending = true;
    setTarget(REST_ANGLE);
  };

  const onScroll = () => refreshRect();
  const onResize = () => refreshRect();
  const observer = new IntersectionObserver(
    ([entry]) => {
      inView = entry.isIntersecting;
      if (!inView) {
        stopFrame();
        return;
      }
      refreshRect();
      if (!finePointer.matches && !hasEnteredTouchMotion) {
        hasEnteredTouchMotion = true;
        current = TOUCH_START_ANGLE;
        velocity = 0;
        target = current + shortestDelta(current, REST_ANGLE);
        returnPending = true;
        setNeedle(current);
      }
      startFrame();
    },
    { threshold: 0.4 },
  );

  stay.addEventListener("pointerenter", onPointerEnter);
  stay.addEventListener("pointermove", onPointerMove);
  stay.addEventListener("pointerleave", onPointerLeave);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  observer.observe(compass);

  cleanups.push(() => {
    stopFrame();
    observer.disconnect();
    stay.removeEventListener("pointerenter", onPointerEnter);
    stay.removeEventListener("pointermove", onPointerMove);
    stay.removeEventListener("pointerleave", onPointerLeave);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onResize);
  });
  document.addEventListener("astro:before-swap", cleanup, { once: true });
}
