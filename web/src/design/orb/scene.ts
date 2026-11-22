/**
 * The orb on empty pages (dev-plans/2026-11-21-portfolio-look §6.3), ported from the owner's
 * mockup: about 2,600 points on a Fibonacci sphere, displaced in the vertex shader (breathing and
 * a ripple, stronger while "thinking"), coloured by height from the accent through the gradient's
 * middle to the error colour, with additive blending and brighter in front; a fresnel core in the
 * accent that pulses; two thin orbit rings in ink with one dot in the "live" colour. It tilts
 * toward the pointer. Where the points sit and which colours it uses are in model.ts (tested);
 * this file is the WebGL part, which needs a real GPU and is left out of the coverage number.
 *
 * Only EmptyOrb loads this file, lazily, so three.js stays out of the main bundle.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from "three";

import { startLoop } from "./loop";
import { orbPalette, spherePoints, thinks, type OrbColors, type OrbState } from "./model";

export type { OrbColors, OrbState } from "./model";

export type Orb = {
  setState: (state: OrbState) => void;
  setColors: (colors: OrbColors) => void;
  dispose: () => void;
};

const POINTS = 2600;

const vertexShader = `
  uniform float uTime; uniform float uThink; uniform float uSize;
  attribute float aSeed; varying float vY; varying float vA;
  void main() {
    vec3 p = position;
    float n = sin(p.x * 3.1 + uTime * 1.1 + aSeed * 6.0) * 0.5
            + sin(p.y * 4.3 - uTime * 1.4) * 0.3
            + sin(p.z * 5.7 + uTime * 0.9 + p.y * 2.0) * 0.2;
    p *= 1.0 + 0.03 * sin(uTime * 1.6) + n * (0.03 + 0.13 * uThink);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.5 + abs(aSeed)) * (3.0 / -mv.z);
    vY = position.y;
    vA = 0.25 + 0.75 * smoothstep(-5.2, -3.2, mv.z);
  }`;

const fragmentShader = `
  uniform vec3 cTop; uniform vec3 cMid; uniform vec3 cLow;
  varying float vY; varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float t = vY * 0.5 + 0.5;
    vec3 col = t < 0.5 ? mix(cLow, cMid, t * 2.0) : mix(cMid, cTop, (t - 0.5) * 2.0);
    gl_FragColor = vec4(col, smoothstep(0.5, 0.0, d) * vA);
  }`;

const coreVertex = `varying vec3 vN; varying vec3 vV;
  void main() { vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;

const coreFragment = `uniform vec3 uColor; uniform float uPulse; varying vec3 vN; varying vec3 vV;
  void main() { float f = pow(1.0 - max(dot(vN, vV), 0.0), 2.2); gl_FragColor = vec4(uColor, f * 0.95 + 0.06 + 0.1 * uPulse); }`;

/** Builds the orb on canvas and starts drawing it. `still` draws one frame only. */
export function createOrb(canvas: HTMLCanvasElement, opts: { state: OrbState; colors: OrbColors; still: boolean }): Orb {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.1, 50);
  camera.position.set(0, 0, 4.2);
  const group = new Group();
  scene.add(group);

  // The particle shell: a Fibonacci sphere (model.ts), displaced in the shader.
  const { positions: pos, seeds: seed } = spherePoints(POINTS);
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new BufferAttribute(seed, 1));
  const uniforms = {
    uTime: { value: 0 },
    uThink: { value: 0 },
    uSize: { value: 5 * renderer.getPixelRatio() },
    cTop: { value: new Color() },
    cMid: { value: new Color() },
    cLow: { value: new Color() },
  };
  group.add(new Points(geo, new ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: AdditiveBlending })));

  // The core: a fresnel glow in the accent.
  const coreU = { uColor: { value: new Color() }, uPulse: { value: 0 } };
  const core = new Mesh(
    new SphereGeometry(0.42, 48, 48),
    new ShaderMaterial({ uniforms: coreU, vertexShader: coreVertex, fragmentShader: coreFragment, transparent: true, depthWrite: false, blending: AdditiveBlending }),
  );
  group.add(core);

  // Two thin orbit rings and a small satellite.
  const ring = (radius: number, opacity: number) => {
    const pts: Vector3[] = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      pts.push(new Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    return new LineLoop(new BufferGeometry().setFromPoints(pts), new LineBasicMaterial({ transparent: true, opacity }));
  };
  const r1 = ring(1.42, 0.14);
  const r2 = ring(1.62, 0.07);
  r1.rotation.set(1.2, 0, 0.35);
  r2.rotation.set(1.05, 0, -0.5);
  scene.add(r1, r2);
  const satMaterial = new PointsMaterial({ size: 0.09, transparent: true, blending: AdditiveBlending, depthWrite: false });
  r1.add(new Points(new BufferGeometry().setFromPoints([new Vector3(1.42, 0, 0)]), satMaterial));

  let state = opts.state;
  const setColors = (c: OrbColors) => {
    const p = orbPalette(c, state);
    uniforms.cTop.value.set(p.top);
    uniforms.cMid.value.set(p.mid);
    uniforms.cLow.value.set(p.low);
    coreU.uColor.value.set(p.top);
    (r1.material as LineBasicMaterial).color.set(p.rings);
    (r2.material as LineBasicMaterial).color.set(p.rings);
    satMaterial.color.set(p.satellite);
  };
  let colors = opts.colors;
  setColors(colors);

  const resize = () => {
    const w = canvas.clientWidth || 440;
    const h = canvas.clientHeight || 440;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  let mx = 0;
  let my = 0;
  const onMove = (e: PointerEvent) => {
    const b = canvas.getBoundingClientRect();
    mx = ((e.clientX - b.left) / b.width - 0.5) * 2;
    my = ((e.clientY - b.top) / b.height - 0.5) * 2;
  };
  const onLeave = () => {
    mx = 0;
    my = 0;
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);

  let t = 0;
  let think = thinks(state) ? 1 : 0;
  const stop = startLoop({
    still: opts.still,
    fps: 60,
    frame: (dt) => {
      const target = thinks(state) ? 1 : 0;
      think += (target - think) * Math.min(dt * 3, 1);
      t += dt * (0.6 + 0.8 * think);
      uniforms.uTime.value = t;
      uniforms.uThink.value = think;
      coreU.uPulse.value = 0.5 + 0.5 * Math.sin(t * 2.4);
      core.scale.setScalar(1 + 0.06 * think * Math.sin(t * 2.4));
      group.rotation.y += dt * (0.12 + 0.3 * think);
      group.rotation.x += (my * 0.35 - group.rotation.x) * Math.min(dt * 4, 1);
      group.rotation.z += (-mx * 0.25 - group.rotation.z) * Math.min(dt * 4, 1);
      r1.rotation.y += dt * (0.25 + 0.6 * think);
      r2.rotation.y -= dt * 0.15;
      renderer.render(scene, camera);
    },
  });

  return {
    setState: (s) => {
      state = s;
      setColors(colors);
    },
    setColors: (c) => {
      colors = c;
      setColors(c);
      if (opts.still) renderer.render(scene, camera);
    },
    dispose: () => {
      stop();
      observer.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
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
