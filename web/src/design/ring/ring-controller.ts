import { angleOf, nearestIndex, rotationFor, seen, snapTarget } from "./ring-math";

/**
 * How much the ring moves: full drifts and carries momentum; reduced only moves when told and
 * eases a little; still jumps from card to card (Effects off, or the OS asks for reduced motion).
 */
export type RingMotion = "full" | "reduced" | "still";

const DRIFT = 7; // degrees a second while nothing touches it
const SETTLE = 9; // how fast it eases to a card (per second)
const DRAG_THRESHOLD = 5; // px before a press counts as a drag
const MOMENTUM: Record<RingMotion, number> = { full: 0.5, reduced: 0.15, still: 0 };

/**
 * The ring's moving parts, outside React: the rotation, a drag, the easing to a card and the slow
 * drift. It writes transforms straight to the card elements (no render per frame), tells React only
 * when the card in front changes, and stops its animation frame whenever the ring is still.
 */
export class RingController {
  slots: Array<HTMLElement | null> = [];
  count = 0;
  radius = 0;
  motion: RingMotion = "full";
  hover = false;
  focus = false;

  private rotation = 0;
  private velocity = 0;
  private target: number | null = null;
  private drag: null | { x: number; start: number; lastX: number; lastT: number; moved: boolean } = null;
  private suppressClick = false;
  private raf = 0;
  private last = 0;
  private wheelTimer = 0;
  private active = 0;

  constructor(private readonly onActive: (i: number) => void) {}

  private drifting(): boolean {
    return this.motion === "full" && !this.hover && !this.focus && !document.hidden && this.count > 1;
  }

  /** Takes the numbers of a new render; the slots list is cut to the count. */
  update(count: number, radius: number, motion: RingMotion): void {
    this.count = count;
    this.radius = radius;
    this.motion = motion;
    this.slots.length = count;
  }

  setSlot(i: number, el: HTMLElement | null): void {
    this.slots[i] = el;
  }

  /** The pointer is over the ring, or the focus is in it: no drift. Leaving wakes it again. */
  setHover(on: boolean): void {
    this.hover = on;
    if (!on) this.wake();
  }

  setFocus(on: boolean): void {
    this.focus = on;
    if (!on) this.wake();
  }

  /**
   * Puts every card in its place for the current rotation: turned to face the centre and pushed out
   * to the wall. The ring's stage sits at the camera (ProjectRing), so the viewer is inside it.
   */
  apply(): void {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const el = this.slots[i];
      if (!el) continue;
      const angle = n > 1 ? angleOf(i, n, this.rotation) : 0;
      const look = seen(angle);
      el.style.transform = `translate(-50%, -50%) rotateY(${(-angle).toFixed(3)}deg) translateZ(${(-this.radius).toFixed(2)}px)`;
      el.style.opacity = look.strength.toFixed(3);
      el.style.visibility = look.visible ? "" : "hidden";
      const behind = !look.visible;
      if (el.inert !== behind) {
        el.inert = behind;
        el.toggleAttribute("aria-hidden", behind);
      }
    }
    const front = nearestIndex(this.rotation, n);
    if (front !== this.active) {
      this.active = front;
      this.onActive(front);
    }
  }

  private tick = (t: number) => {
    const dt = Math.min(0.05, Math.max(0, t - this.last) / 1000);
    this.last = t;
    if (!this.drag) {
      if (this.target !== null) {
        if (this.motion === "still") this.rotation = this.target;
        else this.rotation += (this.target - this.rotation) * Math.min(1, dt * SETTLE);
        if (Math.abs(this.target - this.rotation) < 0.05) {
          this.rotation = this.target;
          this.target = null;
        }
      } else if (this.drifting()) {
        this.rotation -= DRIFT * dt;
      }
    }
    this.apply();
    this.raf = this.drag || this.target !== null || this.drifting() ? requestAnimationFrame(this.tick) : 0;
  };

  /** Starts the animation frame if it isn't running. */
  wake(): void {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    clearTimeout(this.wheelTimer);
  }

  /** Turns the ring so card i comes to the front, the short way round. */
  goTo(i: number): void {
    const n = this.count;
    if (n < 2) return;
    this.target = rotationFor(((i % n) + n) % n, n, this.target ?? this.rotation);
    this.wake();
  }

  /** The card in front, as the loop last saw it. */
  get front(): number {
    return this.active;
  }

  pointerDown(x: number, button: number): void {
    if (button !== 0 || this.count < 2) return;
    this.drag = { x, start: this.rotation, lastX: x, lastT: performance.now(), moved: false };
  }

  /** Returns true when this move turned the press into a drag (the caller captures the pointer). */
  pointerMove(x: number): boolean {
    const d = this.drag;
    if (!d) return false;
    const dx = x - d.x;
    if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD) return false;
    const started = !d.moved;
    if (started) {
      d.moved = true;
      this.target = null;
      this.velocity = 0;
    }
    const degPerPx = 180 / (Math.PI * Math.max(this.radius, 1));
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT) / 1000;
    this.velocity = 0.8 * this.velocity + 0.2 * (((x - d.lastX) * degPerPx) / dt);
    d.lastX = x;
    d.lastT = now;
    this.rotation = d.start + dx * degPerPx;
    this.apply();
    return started;
  }

  pointerUp(): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.moved) {
      this.suppressClick = true;
      this.target = snapTarget(this.rotation, this.velocity, this.count, MOMENTUM[this.motion]);
    }
    this.wake();
  }

  /** Sideways scrolling turns the ring, then it settles on a card. */
  wheel(deltaX: number): void {
    if (this.count < 2) return;
    this.target = null;
    this.rotation -= deltaX * 0.12;
    this.apply();
    clearTimeout(this.wheelTimer);
    this.wheelTimer = window.setTimeout(() => {
      this.target = snapTarget(this.rotation, 0, this.count, 0);
      this.wake();
    }, 140);
  }

  /** A click on card i: the card in front opens (true); another comes to the front. A drag's click is dropped. */
  click(i: number): boolean {
    if (this.suppressClick) {
      this.suppressClick = false;
      return false;
    }
    if (i === this.active || this.count < 2) return true;
    this.goTo(i);
    return false;
  }
}
