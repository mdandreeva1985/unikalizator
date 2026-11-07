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
  noise: [0.5, 1.2],          // едва заметное «зерно», из 255 (сильнее — хуже сжимается)
  speed: [0.975, 1.025],      // скорость ролика (видео + звук)
  volumeDb: [-0.8, 0.8],      // громкость, дБ
  eqGainDb: [-1.5, 1.5],      // лёгкая окраска тембра
  eqFreq: [300, 4000],
  trimStart: [0.05, 0.30],    // обрезка начала, сек
  trimEnd: [0.05, 0.30],      // обрезка конца, сек
  // Качество видео — с запасом, чтобы не терять детали: для 1080×1920 при 30 кадрах 14–18 Мбит/с
  // (пропорционально меньше для меньших роликов), и не ниже 1,5× качества исходника.
  bitrate1080: [14e6, 18e6],
  bitrateVsSource: [1.5, 1.8],
  bitrateMax: 30e6,
  audioBitrates: [160000, 192000],
  keyFrameSec: [1.5, 2.5],
  maxWidth: 1080,             // ролики шире (4K) уменьшаются до 1080
};

// СИЛЬНАЯ УНИКАЛИЗАЦИЯ: заметнее глазу, но кадр «отпечатывается» уже по-другому.
// Значения ниже заменяют обычные, когда включён переключатель.
export const STRONG = {
  zoomPct: [4.5, 6.5],        // приближение сильнее (больше — кадр становится мягче)
  brightness: [-0.04, 0.04],
  contrast: [0.93, 1.08],
  saturation: [0.86, 1.16],
  hueDeg: [-6, 6],
  tint: [0.03, 0.06],         // тёплый или холодный фильтр, сила
  noise: [0.8, 1.6],
  speedDelta: [0.03, 0.045],  // скорость ±3–4,5% (вместе со звуком)
  eqGainDb: [-3, 3],
  volumeDb: [-1.5, 1.5],
};

// РАМКИ: появляются случайно примерно в 2 копиях из 10 (share), цвет — случайный.
// Толщина в долях ширины кадра (0,015–0,03 = тонкая).
export const FRAME = {
  share: 0.2,
  width: [0.015, 0.03],
  white: [[1, 1, 1]],
  colors: [
    [0.07, 0.07, 0.08], [0.96, 0.90, 0.83], [1.0, 0.84, 0.88],
    [0.84, 0.92, 0.97], [0.91, 0.96, 0.91], [1.0, 0.95, 0.77], [0.93, 0.87, 1.0],
  ],
};

const rnd = ([a, b]) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const even = (x) => Math.max(2, Math.round(x / 2) * 2);

// Для серии из total копий выбирает, какие из них будут с рамкой и какой.
// Например, из 10 копий — 2 случайные с рамкой (белой или цветной), из 5 — 1.
export function planFrames(total) {
  const count = Math.round(total * FRAME.share);
  const idx = [...Array(total).keys()].sort(() => Math.random() - 0.5).slice(0, count);
  return Array.from({ length: total }, (_, i) => (idx.includes(i) ? (Math.random() < 0.5 ? 'white' : 'color') : 'none'));
}

// opts.strong — сильная уникализация; opts.frame — 'none' | 'white' | 'color'
// БЕРЕЖНЫЕ КРАЯ: по горизонтали кадр сдвигаем только около центра (обрезка почти поровну
// слева и справа). Если у краёв найден текст (opts.safeEdges) — приближение минимальное.
export const EDGES = {
  cropX: [0.4, 0.6],          // 0 — оставить левый край, 1 — правый; 0,5 — по центру
  safeZoomPct: [1.5, 2.5],
  safeCropX: [0.45, 0.55],
};

export function makeParams(opts = {}) {
  const S = opts.strong ? { ...SETTINGS, ...STRONG } : SETTINGS;
  const p = {
    zoomPct: opts.safeEdges ? rnd(EDGES.safeZoomPct) : rnd(S.zoomPct),
    cropX: rnd(opts.safeEdges ? EDGES.safeCropX : EDGES.cropX), cropY: Math.random(),
    brightness: rnd(S.brightness), contrast: rnd(S.contrast),
    saturation: rnd(S.saturation), gamma: rnd(S.gamma),
    hueDeg: rnd(S.hueDeg), noise: rnd(S.noise),
    speed: rnd(S.speed), volumeDb: rnd(S.volumeDb),
    eqGainDb: rnd(S.eqGainDb), eqFreq: rnd(S.eqFreq),
    trimStart: rnd(S.trimStart), trimEnd: rnd(S.trimEnd),
    bitrate1080: rnd(S.bitrate1080), bitrateVsSource: rnd(S.bitrateVsSource), keyFrameSec: rnd(S.keyFrameSec),
    audioBitrate: pick(S.audioBitrates),
    tint: [1, 1, 1], frameWidth: 0, frameColor: [1, 1, 1],
  };
  if (opts.strong) {
    p.speed = 1 + (Math.random() < 0.5 ? -1 : 1) * rnd(STRONG.speedDelta);
    const t = rnd(STRONG.tint);
    p.tint = Math.random() < 0.5 ? [1 + t, 1 + t * 0.3, 1 - t] : [1 - t, 1 + t * 0.1, 1 + t]; // тёплый / холодный
  }
  if (opts.frame === 'white' || opts.frame === 'color') {
    p.frameWidth = rnd(FRAME.width);
    p.frameColor = pick(opts.frame === 'white' ? FRAME.white : FRAME.colors);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Цвет и зерно: шейдер WebGL (быстро даже на телефоне)
// ---------------------------------------------------------------------------
const VS = `attribute vec2 p; varying vec2 uv;
void main(){ uv = vec2((p.x+1.0)*0.5, 1.0-(p.y+1.0)*0.5); gl_Position = vec4(p,0.0,1.0); }`;
const FS = `precision highp float; varying vec2 uv; uniform sampler2D t;
uniform float br, ct, sat, gam, hue, noise, seed, sharp;
uniform vec3 tint, bcol; uniform vec2 bw, px;
void main(){
  vec2 q = (uv - bw) / (1.0 - 2.0 * bw);
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) { gl_FragColor = vec4(bcol, 1.0); return; }
  vec3 c = texture2D(t, q).rgb;
  // лёгкое повышение резкости (компенсирует мягкость от приближения и масштабирования)
  vec3 nb = texture2D(t, q + vec2(px.x, 0.0)).rgb + texture2D(t, q - vec2(px.x, 0.0)).rgb
          + texture2D(t, q + vec2(0.0, px.y)).rgb + texture2D(t, q - vec2(0.0, px.y)).rgb;
  c = c + sharp * (c - nb * 0.25);
  c *= tint;
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
  const ctxOpts = { preserveDrawingBuffer: true, alpha: false, antialias: false };
  // WebGL2 умеет мип-карты для любых размеров — так уменьшение (например, 4K → 1080) выходит чистым
  const gl = canvas.getContext('webgl2', ctxOpts) || canvas.getContext('webgl', ctxOpts);
  if (!gl) throw new Error('Браузер не поддерживает WebGL');
  const isGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  let useMips = false;
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
  const U = { br: u('br'), ct: u('ct'), sat: u('sat'), gam: u('gam'), hue: u('hue'), noise: u('noise'), seed: u('seed'),
    tint: u('tint'), bcol: u('bcol'), bw: u('bw'), px: u('px'), sharp: u('sharp') };
  return {
    canvas,
    // srcW/srcH — размер кадра исходника после обрезки (до масштабирования)
    setSource(srcW, srcH, frameWidth) {
      const innerW = w * (1 - 2 * frameWidth), innerH = h * (1 - 2 * frameWidth * w / h);
      const scale = srcW / innerW;                 // >1 — уменьшаем, <1 — увеличиваем
      useMips = isGL2 && scale > 1.25;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, useMips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.uniform2f(U.px, 1 / innerW, 1 / innerH);   // шаг резкости = один пиксель результата
      gl.uniform1f(U.sharp, scale < 1 ? 0.45 : 0.25);
    },
    setParams(p) {
      gl.uniform1f(U.br, p.brightness); gl.uniform1f(U.ct, p.contrast);
      gl.uniform1f(U.sat, p.saturation); gl.uniform1f(U.gam, p.gamma);
      gl.uniform1f(U.hue, p.hueDeg * Math.PI / 180); gl.uniform1f(U.noise, p.noise / 255);
      gl.uniform3fv(U.tint, p.tint || [1, 1, 1]);
      gl.uniform3fv(U.bcol, p.frameColor || [1, 1, 1]);
      const fw = p.frameWidth || 0;              // одинаковая толщина в пикселях по всем сторонам
      gl.uniform2f(U.bw, fw, fw * w / h);
    },
    draw(src) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      if (useMips) gl.generateMipmap(gl.TEXTURE_2D);
      gl.uniform1f(U.seed, Math.random() * 100);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.finish();
    },
  };
}

// ---------------------------------------------------------------------------
// Есть ли у левого/правого края текст (субтитры, надписи)?
// Смотрим 12 кадров: строка текста — это ряд резких перепадов яркости, который
// идёт через центр кадра и заходит в крайние 6% по ширине.
// ---------------------------------------------------------------------------
export async function detectEdgeText(file) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return false;
    const dur = await input.computeDuration();
    const w = 180, h = Math.max(2, Math.round(180 * track.displayHeight / track.displayWidth));
    const sink = new CanvasSink(track, { width: w, height: h, fit: 'fill', poolSize: 1 });
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const times = Array.from({ length: 12 }, (_, i) => dur * (0.06 + 0.88 * i / 11));
    const strip = Math.max(3, Math.round(w * 0.06));
    let flagged = 0, checked = 0;
    for await (const wc of sink.canvasesAtTimestamps(times)) {
      if (!wc) continue;
      checked++;
      ctx.drawImage(wc.canvas, 0, 0);
      const px = ctx.getImageData(0, 0, w, h).data;
      const L = (x, y) => { const i = (y * w + x) * 4; return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; };
      let textRows = 0;
      for (let y = 0; y < h; y++) {
        let left = 0, right = 0, mid = 0;
        for (let x = 0; x < w - 1; x++) {
          if (Math.abs(L(x + 1, y) - L(x, y)) < 70) continue;
          if (x < strip) left++; else if (x >= w - 1 - strip) right++; else mid++;
        }
        if (mid >= 10 && (left >= 2 || right >= 2)) textRows++;
      }
      if (textRows >= 3) flagged++;
    }
    return checked > 0 && flagged >= 2;
  } finally {
    input.dispose?.();
  }
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
// Сильная уникализация включена всегда. Рамка — только если её передали (opts.frame).
// opts.signal — для кнопки «Отменить».
export async function makeCopy(file, onProgress = () => {}, opts = {}) {
  const p = makeParams({ strong: true, ...opts });
  const checkCancel = () => {
    if (opts.signal?.aborted) throw new DOMException('Отменено', 'AbortError');
  };
  checkCancel();
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

    // качество — под исходник, частота кадров — ровная, как у обычной записи
    let srcBitrate = 0, srcFps = 30;
    try {
      const st = await vTrack.computePacketStats(300);
      srcBitrate = st.averageBitrate || 0;
      srcFps = st.averagePacketRate || 30;
    } catch {}
    if (!srcBitrate) srcBitrate = (file.size * 8) / Math.max(1, duration);
    const fps = [24, 25, 30, 50, 60].reduce((a, b) => (Math.abs(b - srcFps) < Math.abs(a - srcFps) ? b : a));
    const area = (W * H) / (1080 * 1920);
    p.bitrate = Math.round(Math.min(SETTINGS.bitrateMax,
      // качество исходника пересчитываем на размер копии (4K-исходник «весит» больше, чем нужно для 1080)
      Math.max(p.bitrate1080 * area * (fps / 30), srcBitrate * p.bitrateVsSource * Math.min(1, (W * H) / (dw * dh)))));
    p.fps = fps;

    if (!(await canEncodeVideo('avc', { width: W, height: H, bitrate: p.bitrate,
      ...(opts.software ? { hardwareAcceleration: 'prefer-software' } : {}) }))) {
      throw new Error('Это устройство не умеет кодировать H.264 видео такого размера');
    }

    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const renderer = makeRenderer(W, H);
    renderer.setParams(p);
    renderer.setSource(cw, ch, p.frameWidth || 0);
    // opts.software — кодировать без видеокарты (запасной путь, если аппаратный кодировщик дал сбой)
    const vSource = new CanvasSource(renderer.canvas, {
      codec: 'avc', bitrate: p.bitrate, keyFrameInterval: p.keyFrameSec, latencyMode: 'quality',
      ...(opts.software ? { hardwareAcceleration: 'prefer-software' } : {}),
    });
    output.addVideoTrack(vSource);

    let aSource = null, audio = null;
    if (aTrack && (await aTrack.canDecode())) {
      await ensureAac();
      audio = await processAudio(aTrack, t0, t1, p);
      if (audio) {
        aSource = new AudioBufferSource({ codec: 'aac', bitrate: p.audioBitrate });
        output.addAudioTrack(aSource);
      }
    }
    // новая «дата создания», никаких данных о телефоне и геолокации
    output.setMetadataTags({ creationTime: new Date(Date.now() - Math.random() * 3 * 864e5) });
    await output.start();

    if (opts.signal?.aborted) { await output.cancel().catch(() => {}); checkCancel(); }
    if (aSource) { await aSource.add(audio); aSource.close(); }

    // Кадр берём в исходном размере (только обрезка), а масштабируем сами на видеокарте —
    // с мип-картами и резкостью это чище, чем встроенное масштабирование браузера.
    const sink = new CanvasSink(vTrack, { crop, poolSize: 2 });
    // Ровная сетка кадров (например, ровно 30 в секунду): для каждого кадра копии
    // берём кадр исходника в соответствующий момент с учётом скорости.
    const outDur = (t1 - t0) / p.speed;
    const frameCount = Math.max(1, Math.floor(outDur * fps));
    function* times() {
      for (let j = 0; j < frameCount; j++) yield Math.min(t1 - 0.001, t0 + (j / fps) * p.speed);
    }
    let fi = 0;
    try {
      for await (const wc of sink.canvasesAtTimestamps(times())) {
        checkCancel();
        if (wc) renderer.draw(wc.canvas);   // если кадра нет — повторяем предыдущий
        await vSource.add(fi / fps, 1 / fps);
        fi++;
        if (fi % 10 === 0) onProgress(fi / frameCount);
      }
    } catch (e) {
      await output.cancel().catch(() => {});
      throw e;
    }
    vSource.close();
    await output.finalize();
    return new Blob([output.target.buffer], { type: 'video/mp4' });
  } finally {
    input.dispose?.();
  }
}
