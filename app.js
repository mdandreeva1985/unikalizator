// Уникализатор: вся обработка видео идёт прямо на устройстве (телефон или компьютер).
// Ролики никуда не отправляются, интернет нужен только для первой установки.
import {
  Input, ALL_FORMATS, BlobSource, Output, BufferTarget, Mp4OutputFormat,
  CanvasSource, AudioBufferSource, CanvasSink, AudioBufferSink,
  canEncodeAudio, canEncodeVideo, Quality,
} from 'mediabunny';

// ---------------------------------------------------------------------------
// НАСТРОЙКИ. Для каждой копии берётся случайное значение внутри диапазона.
// ---------------------------------------------------------------------------
export const SETTINGS = {
  zoomPct: [2.0, 3.5],        // приближение кадра (обрезка краёв), %
  brightness: [-0.02, 0.025], // яркость
  contrast: [0.97, 1.04],     // контраст
  saturation: [0.95, 1.08],   // насыщенность
  gamma: [0.97, 1.03],        // средние тона
  hueDeg: [-3, 3],            // оттенок, градусы
  noise: [1, 3],              // лёгкое «зерно», из 255
  speed: [0.975, 1.025],      // скорость ролика (видео + звук)
  volumeDb: [-0.8, 0.8],      // громкость, дБ
  eqGainDb: [-1.5, 1.5],      // лёгкая окраска тембра
  eqFreq: [300, 4000],
  trimStart: [0.05, 0.30],    // обрезка начала, сек
  trimEnd: [0.05, 0.30],      // обрезка конца, сек
  bitrate: [8e6, 11e6],       // качество видео, бит/с
  keyFrameSec: [1.5, 2.5],
  maxWidth: 1080,             // ролики шире (4K) уменьшаются до 1080
};

const rnd = ([a, b]) => a + Math.random() * (b - a);
const even = (x) => Math.max(2, Math.round(x / 2) * 2);

export function makeParams() {
  return {
    zoomPct: rnd(SETTINGS.zoomPct), cropX: Math.random(), cropY: Math.random(),
    brightness: rnd(SETTINGS.brightness), contrast: rnd(SETTINGS.contrast),
    saturation: rnd(SETTINGS.saturation), gamma: rnd(SETTINGS.gamma),
    hueDeg: rnd(SETTINGS.hueDeg), noise: rnd(SETTINGS.noise),
    speed: rnd(SETTINGS.speed), volumeDb: rnd(SETTINGS.volumeDb),
    eqGainDb: rnd(SETTINGS.eqGainDb), eqFreq: rnd(SETTINGS.eqFreq),
    trimStart: rnd(SETTINGS.trimStart), trimEnd: rnd(SETTINGS.trimEnd),
    bitrate: Math.round(rnd(SETTINGS.bitrate)), keyFrameSec: rnd(SETTINGS.keyFrameSec),
  };
}

// ---------------------------------------------------------------------------
// Цвет и зерно: шейдер WebGL (быстро даже на телефоне)
// ---------------------------------------------------------------------------
const VS = `attribute vec2 p; varying vec2 uv;
void main(){ uv = vec2((p.x+1.0)*0.5, 1.0-(p.y+1.0)*0.5); gl_Position = vec4(p,0.0,1.0); }`;
const FS = `precision highp float; varying vec2 uv; uniform sampler2D t;
uniform float br, ct, sat, gam, hue, noise, seed;
void main(){
  vec3 c = texture2D(t, uv).rgb;
  c = pow(max(c, 0.0), vec3(1.0/gam));
  c = (c - 0.5) * ct + 0.5 + br;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, sat);
  float Y = dot(c, vec3(0.299, 0.587, 0.114));
  float I = dot(c, vec3(0.596, -0.274, -0.322));
  float Q = dot(c, vec3(0.211, -0.523, 0.312));
  float cs = cos(hue), sn = sin(hue);
  float I2 = I*cs - Q*sn, Q2 = I*sn + Q*cs;
  c = vec3(Y + 0.956*I2 + 0.621*Q2, Y - 0.272*I2 - 0.647*Q2, Y - 1.106*I2 + 1.703*Q2);
  float n = fract(sin(dot(uv * 997.0 + seed, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  c += n * noise;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function makeRenderer(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, alpha: false, antialias: false });
  if (!gl) throw new Error('Браузер не поддерживает WebGL');
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog); gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.viewport(0, 0, w, h);
  const u = (n) => gl.getUniformLocation(prog, n);
  const U = { br: u('br'), ct: u('ct'), sat: u('sat'), gam: u('gam'), hue: u('hue'), noise: u('noise'), seed: u('seed') };
  return {
    canvas,
    setParams(p) {
      gl.uniform1f(U.br, p.brightness); gl.uniform1f(U.ct, p.contrast);
      gl.uniform1f(U.sat, p.saturation); gl.uniform1f(U.gam, p.gamma);
      gl.uniform1f(U.hue, p.hueDeg * Math.PI / 180); gl.uniform1f(U.noise, p.noise / 255);
    },
    draw(src) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
      gl.uniform1f(U.seed, Math.random() * 100);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.finish();
    },
  };
}

// ---------------------------------------------------------------------------
// Звук: обрезка, скорость, лёгкий эквалайзер и громкость (Web Audio)
// ---------------------------------------------------------------------------
async function processAudio(track, t0, t1, p) {
  const parts = [];
  let sr = track.sampleRate, ch = Math.min(2, track.numberOfChannels || 2);
  for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers(t0, t1)) {
    sr = buffer.sampleRate; ch = Math.min(2, buffer.numberOfChannels);
    parts.push({ buffer, timestamp });
  }
  if (!parts.length) return null;
  const len = Math.max(1, Math.round((t1 - t0) * sr));
  const data = Array.from({ length: ch }, () => new Float32Array(len));
  for (const { buffer, timestamp } of parts) {
    const off = Math.round((timestamp - t0) * sr);
    for (let c = 0; c < ch; c++) {
      const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
      const from = Math.max(0, -off), to = Math.min(src.length, len - off);
      if (to > from) data[c].set(src.subarray(from, to), off + from);
    }
  }
  const outLen = Math.ceil(len / p.speed);
  const ctx = new OfflineAudioContext(ch, outLen, sr);
  const inBuf = ctx.createBuffer(ch, len, sr);
  data.forEach((d, c) => inBuf.copyToChannel(d, c));
  const src = ctx.createBufferSource();
  src.buffer = inBuf;
  src.playbackRate.value = p.speed;
  const eq = ctx.createBiquadFilter();
  eq.type = 'peaking'; eq.frequency.value = p.eqFreq; eq.Q.value = 1; eq.gain.value = p.eqGainDb;
  const gain = ctx.createGain();
  gain.gain.value = Math.pow(10, p.volumeDb / 20);
  src.connect(eq).connect(gain).connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}

let aacReady = null;
async function ensureAac() {
  if (!aacReady) {
    aacReady = (async () => {
      if (!(await canEncodeAudio('aac'))) {
        const { registerAacEncoder } = await import('./vendor/mediabunny-aac-encoder.min.mjs');
        registerAacEncoder();
      }
    })();
  }
  return aacReady;
}

// ---------------------------------------------------------------------------
// Одна копия
// ---------------------------------------------------------------------------
export async function makeCopy(file, onProgress = () => {}, p = makeParams()) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const vTrack = await input.getPrimaryVideoTrack();
    if (!vTrack) throw new Error('В файле нет видео');
    const aTrack = await input.getPrimaryAudioTrack();
    const duration = await input.computeDuration();
    if (duration < 2) { p.trimStart = 0; p.trimEnd = 0; }
    const t0 = p.trimStart, t1 = Math.max(t0 + 0.5, duration - p.trimEnd);

    // размеры
    const dw = vTrack.displayWidth, dh = vTrack.displayHeight;
    let W = dw, H = dh;
    if (SETTINGS.maxWidth && W > SETTINGS.maxWidth) { H = H * SETTINGS.maxWidth / W; W = SETTINGS.maxWidth; }
    W = even(W); H = even(H);
    const k = 1 - p.zoomPct / 100;
    const cw = Math.round(dw * k), ch = Math.round(dh * k);
    const crop = { left: Math.round((dw - cw) * p.cropX), top: Math.round((dh - ch) * p.cropY), width: cw, height: ch };

    if (!(await canEncodeVideo('avc', { width: W, height: H, bitrate: p.bitrate }))) {
      throw new Error('Это устройство не умеет кодировать H.264 видео такого размера');
    }

    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const renderer = makeRenderer(W, H);
    renderer.setParams(p);
    const vSource = new CanvasSource(renderer.canvas, {
      codec: 'avc', bitrate: p.bitrate, keyFrameInterval: p.keyFrameSec, latencyMode: 'quality',
    });
    output.addVideoTrack(vSource);

    let aSource = null, audio = null;
    if (aTrack && (await aTrack.canDecode())) {
      await ensureAac();
      audio = await processAudio(aTrack, t0, t1, p);
      if (audio) {
        aSource = new AudioBufferSource({ codec: 'aac', bitrate: 192000 });
        output.addAudioTrack(aSource);
      }
    }
    // новая «дата создания», никаких данных о телефоне и геолокации
    output.setMetadataTags({ creationTime: new Date(Date.now() - Math.random() * 3 * 864e5) });
    await output.start();

    if (aSource) { await aSource.add(audio); aSource.close(); }

    const sink = new CanvasSink(vTrack, { width: W, height: H, fit: 'fill', crop, poolSize: 2 });
    let last = -1;
    for await (const wc of sink.canvases(t0, t1)) {
      // время кадра считаем от точки обрезки, чтобы звук и губы совпадали
      const ts = Math.max(0, (wc.timestamp - t0) / p.speed);
      const end = (wc.timestamp + wc.duration - t0) / p.speed;
      if (ts <= last) continue;
      last = ts;
      renderer.draw(wc.canvas);
      await vSource.add(ts, Math.max(0.001, end - ts));
      onProgress(Math.min(1, (wc.timestamp - t0) / (t1 - t0)));
    }
    vSource.close();
    await output.finalize();
    return new Blob([output.target.buffer], { type: 'video/mp4' });
  } finally {
    input.dispose?.();
  }
}
