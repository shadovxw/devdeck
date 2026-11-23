/**
 * The mini orb's WebGL part (dev-plans/2026-11-21-portfolio-look §8d): one small scene for
 * every empty page. The variant's points and motion come from mini-model.ts (tested); this file
 * draws them, coloured by height like the big orb, in the theme's colours (the success colour
 * for good news). It needs a real GPU, so like the big orb's scene it is left out of coverage.
 * Only MiniCanvas loads it, lazily, sharing three.js's chunk with the big orb.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, PerspectiveCamera, Points, Scene, ShaderMaterial, WebGLRenderer } from "three";

import { startLoop } from "./loop";
import { isGoodNews, miniLayout, miniPositions, miniSpin, type MiniVariant } from "./mini-model";
import { ORB_CAMERA, orbPalette, type OrbColors } from "./model";

export type MiniOrb = { setColors: (c: OrbColors) => void; dispose: () => void };

const vertexShader = `
  uniform float uSize; attribute float aGlow; attribute float aSeed; varying float vY; varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.6 + aSeed * 0.8) * (3.0 / -mv.z);
    vY = position.y;
    vA = aGlow * (0.35 + 0.65 * smoothstep(-5.0, -3.4, mv.z));
  }`;

const fragmentShader = `
  uniform vec3 cTop; uniform vec3 cMid; uniform vec3 cLow; varying float vY; varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float t = clamp(vY * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = t < 0.5 ? mix(cLow, cMid, t * 2.0) : mix(cMid, cTop, (t - 0.5) * 2.0);
    gl_FragColor = vec4(col, smoothstep(0.5, 0.0, d) * vA);
  }`;

/** Builds a mini orb on canvas and starts it. `still` draws one frame. */
export function createMiniOrb(canvas: HTMLCanvasElement, opts: { variant: MiniVariant; colors: OrbColors; still: boolean }): MiniOrb {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new Scene();
  const camera = new PerspectiveCamera(ORB_CAMERA.fov, 1, 0.1, 50);
  camera.position.set(0, 0, ORB_CAMERA.z);
  const group = new Group();
  group.rotation.x = 0.25;
  scene.add(group);

  const layout = miniLayout(opts.variant);
  const positions = new Float32Array(layout.base);
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.setAttribute("aGlow", new BufferAttribute(layout.glow, 1));
  geo.setAttribute("aSeed", new BufferAttribute(layout.seeds, 1));
  const uniforms = { uSize: { value: 4 * renderer.getPixelRatio() }, cTop: { value: new Color() }, cMid: { value: new Color() }, cLow: { value: new Color() } };
  group.add(new Points(geo, new ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: AdditiveBlending })));

  const setColors = (c: OrbColors) => {
    const p = orbPalette(c, isGoodNews(opts.variant) ? "ok" : "idle");
    uniforms.cTop.value.set(p.top);
    uniforms.cMid.value.set(p.mid);
    uniforms.cLow.value.set(p.low);
  };
  setColors(opts.colors);

  const size = () => {
    const w = canvas.clientWidth || 120;
    const h = canvas.clientHeight || 120;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  size();

  let t = 0;
  const spin = miniSpin(opts.variant);
  const stop = startLoop({
    still: opts.still,
    fps: 30,
    frame: (dt) => {
      t += dt;
      miniPositions(opts.variant, layout, t, positions);
      geo.attributes.position.needsUpdate = true;
      group.rotation.y += dt * spin;
      renderer.render(scene, camera);
    },
  });

  return {
    setColors: (c) => {
      setColors(c);
      if (opts.still) renderer.render(scene, camera);
    },
    dispose: () => {
      stop();
      geo.dispose();
      scene.traverse((o) => {
        const m = o as Points;
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
    },
  };
}
