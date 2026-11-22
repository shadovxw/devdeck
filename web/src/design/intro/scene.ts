/**
 * The launch intro's WebGL part (dev-plans/2026-11-21-portfolio-look §8b, P9b), ported from the
 * owner's design: the D mark extruded from the logo's SVG paths (the stem flies in, the ribbon
 * swings shut on its hinge, the `>_` pops onto the front), and one particle system for the whole
 * film: scattered → a ring around the lockup → Home's orb, on the same Fibonacci sphere as the
 * real orb (orb/model.ts) so the hand-off is seamless. What happens when is in timeline.ts
 * (tested); this file draws a frame of it and, like the orb's scene, needs a real GPU, so it is
 * left out of the coverage number.
 *
 * Only Intro.tsx loads this file, lazily, so three.js stays out of the main bundle.
 */
import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Points,
  Scene,
  ShaderMaterial,
  Shape,
  Vector3,
  WebGLRenderer,
} from "three";

import { orbPalette, spherePoints, type OrbColors } from "../orb/model";
import type { IntroFrame } from "./timeline";

/** The mark's colours (the brand's) and the orb's (the theme's). */
export type IntroColors = { stem: string; ribbon: string; prompt: string; orb: OrbColors };

/** Where things land, in CSS pixels from the canvas's top left. */
export type IntroTargets = {
  /** Home's orb: its centre and the radius of its sphere on screen. */
  orb: { x: number; y: number; r: number };
  /** The sidebar's mark: its centre and size. */
  mark: { x: number; y: number; size: number };
};

export type IntroScene = {
  draw: (f: IntroFrame, t: number, targets: IntroTargets) => void;
  dispose: () => void;
};

const FOV = 35;
const CAMERA_Z = 9;
const N = 2600;
/** The mark's width in world units at scale 1 (the SVG's 320 units). */
const MARK = 2.2;

/** A small seeded random, so every start looks the same and no Math.random is needed. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const vertexShader = `
  attribute vec3 aStart; attribute vec3 aHalo; attribute float aSeed;
  uniform float uT, uM1, uM2, uSize, uHaloRot, uOrbRot, uOrbR, uOpacity;
  uniform vec3 uOrbC, cDust, cTop, cMid, cLow;
  varying vec3 vCol; varying float vA;
  vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
  void main() {
    vec3 h = rotY(aHalo, uHaloRot * (0.7 + 0.6 * aSeed));
    h = vec3(h.x, h.y + h.z * 0.28, h.z * 0.6);
    vec3 s = position;
    float n = sin(s.x * 3.1 + uT * 1.1 + aSeed * 6.0) * 0.5 + sin(s.y * 4.3 - uT * 1.4) * 0.3 + sin(s.z * 5.7 + uT * 0.9 + s.y * 2.0) * 0.2;
    vec3 sp = rotY(s, uOrbRot) * (1.0 + 0.03 * sin(uT * 1.6) + n * 0.07);
    vec3 orb = uOrbC + sp * uOrbR;
    float m2 = smoothstep(0.0, 1.0, clamp(uM2 * 1.7 - aSeed * 0.7, 0.0, 1.0));
    vec3 a = mix(aStart, h, uM1);
    float arc = sin(m2 * 3.14159);
    vec3 p = mix(a, orb, m2) + vec3(0.0, arc * 0.5 * (aSeed - 0.4), arc * 1.2);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * mix(0.75, 0.5 + aSeed, m2) * (9.0 / -mv.z);
    float t = s.y * 0.5 + 0.5;
    vec3 grad = t < 0.5 ? mix(cLow, cMid, t * 2.0) : mix(cMid, cTop, (t - 0.5) * 2.0);
    vCol = mix(cDust, grad, m2);
    vA = uOpacity * mix(0.35 + 0.5 * aSeed, 0.25 + 0.75 * (sp.z * 0.5 + 0.5), m2);
  }`;

const fragmentShader = `
  varying vec3 vCol; varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vCol, smoothstep(0.5, 0.0, d) * vA);
  }`;

type Cmd = ["M" | "L", number, number] | ["Q", number, number, number, number] | ["C", number, number, number, number, number, number];

/** Builds the intro on canvas. It draws only when asked (Intro.tsx runs the clock). */
export function createIntroScene(canvas: HTMLCanvasElement, colors: IntroColors): IntroScene {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1.6, 0.1, 100);
  camera.position.set(0, 0, CAMERA_Z);
  scene.add(new AmbientLight(0xffffff, 0.45));
  const key = new DirectionalLight(0xffffff, 1.8);
  key.position.set(3, 4, 6);
  scene.add(key);
  const rim = new PointLight(colors.ribbon, 30, 20);
  rim.position.set(-4, 2.5, -2);
  scene.add(rim);
  const sweep = new PointLight(colors.ribbon, 0, 12);
  scene.add(sweep);

  // ---- the D mark, from the logo's SVG paths (design/Logo.tsx) ----
  const S = MARK / 320;
  const P = (x: number, y: number): [number, number] => [(x - 160) * S, -(y - 160) * S];
  const shape = (cmds: Cmd[]) => {
    const sh = new Shape();
    for (const c of cmds) {
      if (c[0] === "M") sh.moveTo(...P(c[1], c[2]));
      else if (c[0] === "L") sh.lineTo(...P(c[1], c[2]));
      else if (c[0] === "Q") sh.quadraticCurveTo(...P(c[1], c[2]), ...P(c[3], c[4]));
      else if (c[0] === "C") sh.bezierCurveTo(...P(c[1], c[2]), ...P(c[3], c[4]), ...P(c[5], c[6]));
    }
    return sh;
  };
  const ext = { depth: 40 * S, bevelEnabled: true, bevelThickness: 4 * S, bevelSize: 3 * S, bevelSegments: 3, curveSegments: 32 };
  const material = (color: string, emissive: number) =>
    new MeshStandardMaterial({ color, emissive: color, metalness: 0.35, roughness: 0.32, emissiveIntensity: emissive, transparent: true, opacity: 0 });

  const logo = new Group();
  scene.add(logo);
  const stemMat = material(colors.stem, 0.15);
  const stem = new Mesh(new ExtrudeGeometry(shape([["M", 0, 8], ["L", 80, 84], ["L", 80, 236], ["L", 0, 312], ["L", 0, 8]]), ext), stemMat);
  logo.add(stem);

  const hingeX = P(80, 0)[0];
  const ribbonPivot = new Group();
  ribbonPivot.position.x = hingeX;
  logo.add(ribbonPivot);
  const ribbonGeo = new ExtrudeGeometry(
    shape([
      ["M", 12, 0], ["L", 195, 0], ["Q", 215, 0, 229, 15], ["L", 298, 90], ["Q", 320, 115, 320, 165],
      ["C", 320, 250, 260, 320, 185, 320], ["L", 12, 320], ["L", 92, 244], ["L", 185, 244],
      ["C", 250, 244, 280, 190, 270, 173], ["L", 175, 76], ["L", 92, 76], ["L", 12, 0],
    ]),
    ext,
  );
  ribbonGeo.translate(-hingeX, 0, 0);
  const ribbonMat = material(colors.ribbon, 0.12);
  ribbonPivot.add(new Mesh(ribbonGeo, ribbonMat));

  const front = 46 * S;
  const promptMat = material(colors.prompt, 0.9);
  const segment = (x1: number, y1: number, x2: number, y2: number) => {
    const a = P(x1, y1);
    const b = P(x2, y2);
    const m = new Mesh(new BoxGeometry(Math.hypot(b[0] - a[0], b[1] - a[1]) + 17 * S, 17 * S, 10 * S), promptMat);
    m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, front);
    m.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0]);
    return m;
  };
  const chevron = new Group();
  chevron.add(segment(118, 128, 152, 160), segment(152, 160, 118, 192));
  const cc = P(135, 160);
  for (const m of chevron.children) {
    m.position.x -= cc[0];
    m.position.y -= cc[1];
  }
  chevron.position.set(cc[0], cc[1], 0);
  logo.add(chevron);
  const under = new Mesh(new BoxGeometry(54 * S, 16 * S, 10 * S), promptMat);
  const uc = P(193, 194);
  under.position.set(uc[0], uc[1], front);
  logo.add(under);

  // ---- one particle system: scattered → ring around the lockup → Home's orb ----
  const rand = seeded(20261122);
  const aStart = new Float32Array(N * 3);
  const aHalo = new Float32Array(N * 3);
  const { positions, seeds } = spherePoints(N);
  for (let i = 0; i < N; i++) {
    const r = 4 + rand() * 5;
    const th = rand() * Math.PI * 2;
    const ph = Math.acos(2 * rand() - 1);
    aStart.set([r * Math.sin(ph) * Math.cos(th) * 1.5, r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph) - 3], i * 3);
    const ha = rand() * Math.PI * 2;
    const hr = 2.3 + rand() ** 2 * 1.6;
    aHalo.set([Math.cos(ha) * hr * 1.25, (rand() - 0.5) * 0.35, Math.sin(ha) * hr], i * 3);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.setAttribute("aStart", new BufferAttribute(aStart, 3));
  geo.setAttribute("aHalo", new BufferAttribute(aHalo, 3));
  geo.setAttribute("aSeed", new BufferAttribute(seeds, 1));
  const palette = orbPalette(colors.orb, "idle");
  const U = {
    uT: { value: 0 },
    uM1: { value: 0 },
    uM2: { value: 0 },
    uOpacity: { value: 0 },
    uSize: { value: 4.2 * renderer.getPixelRatio() },
    uHaloRot: { value: 0 },
    uOrbRot: { value: 0 },
    uOrbC: { value: new Vector3() },
    uOrbR: { value: 1 },
    cDust: { value: new Color(colors.orb.primary) },
    cTop: { value: new Color(palette.top) },
    cMid: { value: new Color(palette.mid) },
    cLow: { value: new Color(palette.low) },
  };
  const points = new Points(geo, new ShaderMaterial({ uniforms: U, vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: AdditiveBlending }));
  points.frustumCulled = false;
  scene.add(points);

  let width = 0;
  let height = 0;
  const resize = () => {
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  /** Pixels per world unit on the z = 0 plane. */
  const ppu = () => height / (2 * Math.tan(((FOV / 2) * Math.PI) / 180) * CAMERA_Z);
  const toWorld = (x: number, y: number) => [(x - width / 2) / ppu(), (height / 2 - y) / ppu()] as const;

  return {
    draw: (f, t, targets) => {
      const k = ppu();
      U.uT.value = t;
      U.uM1.value = f.gather;
      U.uM2.value = f.stream;
      U.uOpacity.value = f.particles;
      U.uHaloRot.value = t * 0.35;
      U.uOrbRot.value = t * 0.25;
      const [ox, oy] = toWorld(targets.orb.x, targets.orb.y);
      U.uOrbC.value.set(ox, oy, 0);
      U.uOrbR.value = targets.orb.r / k;

      stem.position.z = -5 * (1 - f.stem);
      stem.rotation.y = -1.1 * (1 - f.stem);
      ribbonPivot.rotation.y = -1.9 * (1 - f.ribbon);
      chevron.scale.setScalar(f.prompt);
      under.visible = f.cursor && f.mark > 0.01;
      stemMat.opacity = Math.min(1, f.stem) * f.mark;
      ribbonMat.opacity = f.ribbonOpacity * f.mark;
      promptMat.opacity = Math.min(1, f.prompt * 3) * f.mark;

      // The lockup: the mark turns to face you and moves left, then flies to the sidebar's mark.
      logo.rotation.y = -0.55 * (1 - f.turn);
      logo.rotation.x = 0.2 * (1 - f.turn);
      const lockScale = 1 - 0.45 * f.turn;
      const lockX = -1.75 * f.turn;
      const [mx, my] = toWorld(targets.mark.x, targets.mark.y);
      logo.position.x = lockX + (mx - lockX) * f.exit;
      logo.position.y = my * f.exit;
      logo.scale.setScalar(lockScale + (targets.mark.size / (MARK * k) - lockScale) * f.exit);

      sweep.intensity = 40 * f.sweep;
      sweep.position.set(-3 + 6 * Math.min(1, Math.max(0, (t - 2.2) / 0.6)), 0.5, 2);
      renderer.render(scene, camera);
    },
    dispose: () => {
      observer.disconnect();
      scene.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
    },
  };
}
