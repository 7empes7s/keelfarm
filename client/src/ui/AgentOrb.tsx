// The call's orb (#534): ElevenLabs UI's Orb (MIT, https://ui.elevenlabs.io/docs/components/orb, elevenlabs/ui
// orb.tsx) ported from three.js to a bare WebGL2 canvas, so a phone's call screen never loads three.js. The shader is
// theirs, unchanged but for GLSL ES 3.00 and a circle mask; the noise texture is made here instead of fetched from
// their CDN; the colours are the design tokens. It reacts to listening, thinking and talking, and to the mic's and the
// voice's levels. Without WebGL2 (or with reduced motion, still) the CSS orb behind it shows instead.
import { useEffect, useRef, useState } from 'react';
import { reduceMotion } from './a11y';
import type { OrbState } from './agentCall';
import { useAgentCall } from './agentCallStore';

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform float uTime;
uniform float uAnimation;
uniform float uInverted;
uniform float uOffsets[7];
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform float uInputVolume;
uniform float uOutputVolume;
uniform float uOpacity;
uniform sampler2D uPerlinTexture;
in vec2 vUv;
out vec4 fragColor;
const float PI = 3.14159265358979323846;
bool drawOval(vec2 polarUv, vec2 polarCenter, float a, float b, bool reverseGradient, float softness, out vec4 color) {
  vec2 p = polarUv - polarCenter;
  float oval = (p.x * p.x) / (a * a) + (p.y * p.y) / (b * b);
  float edge = smoothstep(1.0, 1.0 - softness, oval);
  if (edge > 0.0) {
    float gradient = reverseGradient ? (1.0 - (p.x / a + 1.0) / 2.0) : ((p.x / a + 1.0) / 2.0);
    gradient = mix(0.5, gradient, 0.1);
    color = vec4(vec3(gradient), 0.85 * edge);
    return true;
  }
  return false;
}
vec3 colorRamp(float g, vec3 c1, vec3 c2, vec3 c3, vec3 c4) {
  if (g < 0.33) return mix(c1, c2, g * 3.0);
  if (g < 0.66) return mix(c2, c3, (g - 0.33) * 3.0);
  return mix(c3, c4, (g - 0.66) * 3.0);
}
vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float n = mix(mix(dot(hash2(i), f), dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
                mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)), dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);
  return 0.5 + 0.5 * n;
}
float sharpRing(vec3 d, float time) {
  float noise = mix(noise2D(vec2(d.x, time) * 5.0), noise2D(vec2(d.y, time) * 5.0), d.z);
  return 1.0 + (noise - 0.5) * 2.5 * 0.3 * 1.5;
}
float smoothRing(vec3 d, float time) {
  float noise = mix(noise2D(vec2(d.x, time) * 6.0), noise2D(vec2(d.y, time) * 6.0), d.z);
  return 0.9 + (noise - 0.5) * 5.0 * 0.2;
}
float flow(vec3 d, float time) {
  return mix(texture(uPerlinTexture, vec2(time, d.x / 2.0)).r, texture(uPerlinTexture, vec2(time, d.y / 2.0)).r, d.z);
}
void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  float radius = length(uv);
  if (radius > 1.0) discard;
  float theta = atan(uv.y, uv.x);
  if (theta < 0.0) theta += 2.0 * PI;
  vec3 decomposed = vec3(theta / (2.0 * PI), mod(theta / (2.0 * PI) + 0.5, 1.0) + 1.0, abs(theta / PI - 1.0));
  float noise = flow(decomposed, radius * 0.03 - uAnimation * 0.2) - 0.5;
  theta += noise * mix(0.08, 0.25, uOutputVolume);
  vec4 color = vec4(1.0);
  float originalCenters[7] = float[7](0.0, 0.5 * PI, 1.0 * PI, 1.5 * PI, 2.0 * PI, 2.5 * PI, 3.0 * PI);
  float centers[7];
  for (int i = 0; i < 7; i++) centers[i] = originalCenters[i] + 0.5 * sin(uTime / 20.0 + uOffsets[i]);
  vec4 ovalColor;
  for (int i = 0; i < 7; i++) {
    float n = texture(uPerlinTexture, vec2(mod(centers[i] + uTime * 0.05, 1.0), 0.5)).r;
    float a = 0.5 + n * 0.3;
    float b = n * mix(3.5, 2.5, uInputVolume);
    float distTheta = min(abs(theta - centers[i]), min(abs(theta + 2.0 * PI - centers[i]), abs(theta - 2.0 * PI - centers[i])));
    if (drawOval(vec2(distTheta, radius), vec2(0.0), a, b, i % 2 == 1, 0.6, ovalColor)) {
      color.rgb = mix(color.rgb, ovalColor.rgb, ovalColor.a);
      color.a = max(color.a, ovalColor.a);
    }
  }
  float ringRadius1 = sharpRing(decomposed, uTime * 0.1);
  float ringRadius2 = smoothRing(decomposed, uTime * 0.1);
  float inputRadius1 = radius + uInputVolume * 0.2;
  float inputRadius2 = radius + uInputVolume * 0.15;
  float ringAlpha1 = (inputRadius2 >= ringRadius1) ? mix(0.2, 0.6, uInputVolume) : 0.0;
  float ringAlpha2 = smoothstep(ringRadius2 - 0.05, ringRadius2 + 0.05, inputRadius1) * mix(0.15, 0.45, uInputVolume);
  float totalRingAlpha = max(ringAlpha1, ringAlpha2);
  color.rgb = 1.0 - (1.0 - color.rgb) * (1.0 - vec3(1.0) * totalRingAlpha);
  float luminance = mix(color.r, 1.0 - color.r, uInverted);
  color.rgb = colorRamp(luminance, vec3(0.0), uColor1, uColor2, vec3(1.0));
  color.a *= uOpacity * smoothstep(1.0, 0.98, radius);
  fragColor = vec4(color.rgb * color.a, color.a);
}`;

/** A tileable smooth noise texture, standing in for their perlin-noise.png. */
function noiseTexture(size = 128): Uint8Array {
  const grid = 8;
  const lattice = Array.from({ length: grid * grid }, (_, i) => (Math.sin(i * 127.1 + 311.7) * 43758.5453) % 1);
  const at = (x: number, y: number) => Math.abs(lattice[(((y % grid) + grid) % grid) * grid + (((x % grid) + grid) % grid)]);
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * grid;
      const fy = (y / size) * grid;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const sx = (fx - ix) * (fx - ix) * (3 - 2 * (fx - ix));
      const sy = (fy - iy) * (fy - iy) * (3 - 2 * (fy - iy));
      const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
      const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
      const v = Math.round((top + (bottom - top) * sy) * 255);
      out.set([v, v, v, 255], (y * size + x) * 4);
    }
  return out;
}

/** A design token's colour as 0..1 RGB (the browser parses it). */
function tokenRgb(name: string, fallback: [number, number, number]): [number, number, number] {
  const probe = document.createElement('span');
  probe.style.color = `var(${name})`;
  document.body.appendChild(probe);
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(probe).color);
  probe.remove();
  return m ? [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255] : fallback;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

/** The animation's targets for a state at time t, as theirs ("auto" volume mode), lifted by the real levels. */
function targets(state: OrbState, t: number, input: number, output: number): [number, number] {
  let i = 0;
  let o = 0.3;
  if (state === 'listening') [i, o] = [clamp01(0.55 + Math.sin(t * 3.2) * 0.35), 0.45];
  else if (state === 'talking') [i, o] = [clamp01(0.65 + Math.sin(t * 4.8) * 0.22), clamp01(0.75 + Math.sin(t * 3.6) * 0.22)];
  else if (state === 'thinking') [i, o] = [clamp01(0.38 + 0.07 * Math.sin(t * 0.7) + 0.05 * Math.sin(t * 2.1) * Math.sin(t * 0.37 + 1.2)), clamp01(0.48 + 0.12 * Math.sin(t * 1.05 + 0.6))];
  return [Math.max(i, input), Math.max(o, output)];
}

/** Draws the orb on a canvas filling its parent; returns false when WebGL2 isn't there (the parent's CSS orb shows). */
export default function AgentOrb({ state }: { state: OrbState }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [failed, setFailed] = useState(false);
  const redraw = useRef<() => void>(() => undefined);
  useEffect(() => {
    redraw.current();
  }, [state]); // a still orb (reduced motion) draws again when the state changes

  useEffect(() => {
    const el = canvas.current;
    const gl = el?.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!el || !gl) {
      setFailed(true);
      return;
    }
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      setFailed(true);
      return;
    }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, noiseTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const u = (name: string) => gl.getUniformLocation(prog, name);
    gl.uniform1fv(u('uOffsets'), Array.from({ length: 7 }, (_, i) => ((Math.sin(i * 12.9898) * 43758.5453) % 1) * Math.PI * 2));
    gl.uniform3fv(u('uColor1'), tokenRgb('--ds-accent', [0.79, 0.86, 0.99]));
    gl.uniform3fv(u('uColor2'), tokenRgb('--ds-series-4', [0.63, 0.73, 0.82]));
    gl.uniform1f(u('uInverted'), 0);
    gl.uniform1i(u('uPerlinTexture'), 0);
    const lost = (e: Event) => {
      e.preventDefault();
      setFailed(true);
    };
    el.addEventListener('webglcontextlost', lost);

    let frame = 0;
    let last = performance.now();
    let time = 0;
    let anim = 0.1;
    let speed = 0.1;
    let opacity = 0;
    let curIn = 0;
    let curOut = 0;
    const still = reduceMotion();
    const draw = (now: number) => {
      frame = still ? 0 : requestAnimationFrame(draw);
      if (document.hidden) return;
      const delta = Math.min(0.1, (now - last) / 1000);
      if (!still && delta < 1 / 40) return; // about 30 frames a second is plenty for a soft orb
      last = now;
      const w = Math.round(el.clientWidth * Math.min(2, devicePixelRatio));
      if (el.width !== w) el.width = el.height = w;
      gl.viewport(0, 0, el.width, el.height);
      time += delta * 0.5;
      opacity = still ? 1 : Math.min(1, opacity + delta * 2);
      const { input, output } = useAgentCall.getState();
      const [ti, to] = targets(stateRef.current, time * 2, input, output);
      curIn += (ti - curIn) * 0.2;
      curOut += (to - curOut) * 0.2;
      speed += (0.1 + (1 - (curOut - 1) ** 2) * 0.9 - speed) * 0.12;
      anim += delta * speed;
      gl.uniform1f(u('uTime'), time);
      gl.uniform1f(u('uAnimation'), anim);
      gl.uniform1f(u('uInputVolume'), curIn);
      gl.uniform1f(u('uOutputVolume'), curOut);
      gl.uniform1f(u('uOpacity'), opacity);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    frame = requestAnimationFrame(draw);
    redraw.current = () => {
      if (still) requestAnimationFrame(draw);
    };
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('webglcontextlost', lost);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  if (failed) return null;
  return <canvas ref={canvas} className="vcall-orb-canvas" data-orb={state ?? 'idle'} aria-hidden />;
}
