/**
 * The mini orb's plain parts (dev-plans/2026-11-21-portfolio-look §8d): one small particle
 * scene for every empty page, where each variant only changes where the points sit and how they
 * move, so the page hints at what it holds. No three.js here, so it is tested; mini.ts draws it.
 */
import { spherePoints } from "./model";

/** The variants built so far (P5a); P5b adds the rest of the table. */
export type MiniVariant = "plain" | "workspaces" | "repos" | "stacks" | "logs" | "resources" | "findings";

export const MINI_VARIANTS: readonly MiniVariant[] = ["plain", "workspaces", "repos", "stacks", "logs", "resources", "findings"];

/** Points per mini orb: enough to read as a shape at about 120px. */
export const MINI_POINTS = 700;

/** Good news: drawn in the success colour, calm, never the accent. */
export const isGoodNews = (v: MiniVariant) => v === "findings";

export type MiniLayout = {
  /** Where each point rests, x y z, radius about 1. */
  base: Float32Array;
  /** How bright each point is, 0 to 1 (Workspaces dims the unlit orbs). */
  glow: Float32Array;
  /** A number in [0, 1) per point, to vary size and timing. */
  seeds: Float32Array;
};

const set3 = (a: Float32Array, i: number, x: number, y: number, z: number) => {
  a[i * 3] = x;
  a[i * 3 + 1] = y;
  a[i * 3 + 2] = z;
};

/** Where the points of a variant rest. The same variant and count always give the same layout. */
export function miniLayout(variant: MiniVariant, n = MINI_POINTS): MiniLayout {
  const sphere = spherePoints(n);
  const base = new Float32Array(n * 3);
  const glow = new Float32Array(n).fill(1);
  const { seeds } = sphere;
  const s = (i: number, k: number) => sphere.positions[i * 3 + k];

  for (let i = 0; i < n; i++) {
    const [x, y, z] = [s(i, 0), s(i, 1), s(i, 2)];
    switch (variant) {
      case "workspaces": {
        // Three small orbs in a row; the middle one lit.
        const k = i % 3;
        const r = 0.38;
        set3(base, i, (k - 1) * 0.95 + x * r, y * r, z * r);
        glow[i] = k === 1 ? 1 : 0.28;
        break;
      }
      case "repos": {
        // A ring of dots, like commits on a loop: 12 small clusters on a circle.
        const c = i % 12;
        const a = (c / 12) * Math.PI * 2;
        const r = 0.11;
        set3(base, i, Math.cos(a) * 0.9 + x * r, Math.sin(a) * 0.9 * 0.55 + y * r, Math.sin(a) * 0.4 + z * r);
        break;
      }
      case "stacks": {
        // The orb split into three stacked layers, apart.
        const layer = y > 0.33 ? 1 : y < -0.33 ? -1 : 0;
        set3(base, i, x, y + layer * 0.22, z);
        break;
      }
      case "logs": {
        // A column the width of the orb; motion makes it fall.
        set3(base, i, x * 0.55, (seeds[i] - 0.5) * 2.2, z * 0.55);
        break;
      }
      case "resources": {
        // A smaller orb with a flat line through it: every fifth point lies on the line.
        if (i % 5 === 0) set3(base, i, (seeds[i] - 0.5) * 2.4, 0, 0.3);
        else set3(base, i, x * 0.6, y * 0.6, z * 0.6);
        break;
      }
      default:
        set3(base, i, x, y, z);
    }
  }
  return { base, glow, seeds };
}

/** The heartbeat: two quick beats, then rest, once a second and a half (0 to 1). */
export function heartbeat(t: number): number {
  const p = (t % 1.5) / 1.5;
  const beat = (c: number) => Math.exp(-(((p - c) / 0.035) ** 2));
  return Math.min(1, beat(0.1) + 0.6 * beat(0.25));
}

/**
 * Where the points are at time t (seconds), written into `out`. Plain, Workspaces, Repos and
 * Findings turn slowly as a whole (mini.ts rotates them); these move their points:
 * Stacks' layers bob apart, Logs fall and wrap, Resources' orb beats while its line stays flat.
 */
export function miniPositions(variant: MiniVariant, layout: MiniLayout, t: number, out: Float32Array): Float32Array {
  const { base, seeds } = layout;
  const n = seeds.length;
  for (let i = 0; i < n; i++) {
    let x = base[i * 3];
    let y = base[i * 3 + 1];
    let z = base[i * 3 + 2];
    if (variant === "stacks") {
      const layer = y > 0.4 ? 1 : y < -0.4 ? -1 : 0;
      y += layer * 0.06 * Math.sin(t * 1.2);
    } else if (variant === "logs") {
      // Fall at a speed set by the seed; wrap from the bottom back to the top.
      const span = 2.2;
      y = ((((y + 1.1 - t * (0.35 + 0.4 * seeds[i])) % span) + span) % span) - 1.1;
    } else if (variant === "resources" && i % 5 !== 0) {
      const k = 1 + 0.18 * heartbeat(t);
      x *= k;
      y *= k;
      z *= k;
    } else if (variant === "workspaces" && i % 3 === 1) {
      // The lit orb breathes in place.
      const k = 1 + 0.08 * Math.sin(t * 1.6);
      y *= k;
      z *= k;
      x *= k;
    } else if (variant === "findings") {
      const k = 1 + 0.025 * Math.sin(t * 0.8);
      x *= k;
      y *= k;
      z *= k;
    }
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  }
  return out;
}

/** How fast the whole thing turns (radians a second): calm for good news; still for Logs' column and Workspaces' row (turning it would line the orbs up). */
export const miniSpin = (v: MiniVariant) => (v === "findings" ? 0.08 : v === "logs" || v === "workspaces" ? 0 : 0.25);
