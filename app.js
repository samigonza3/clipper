/* GlassCut — prototipo de clipping local
   Todo el procesamiento ocurre en el navegador: no hay backend ni subida de archivos. */

const $ = (id) => document.getElementById(id);

const el = {
  landing: $('landing'), editor: $('editor'), drop: $('drop'), fileInput: $('fileInput'),
  fileLabel: $('fileLabel'), btnAnalyze: $('btnAnalyze'), btnChange: $('btnChange'),
  video: $('video'), frame: $('frame'), panX: $('panX'), hook: $('hookOverlay'),
  btnPlay: $('btnPlay'), timeNow: $('timeNow'), wave: $('wave'), playhead: $('playhead'),
  clipList: $('clipList'), emptyClips: $('emptyClips'), clipLen: $('clipLen'),
  btnExport: $('btnExport'), btnJSON: $('btnJSON'), btnManual: $('btnManual'),
  btnAI: $('btnAI'), cap: $('capOverlay'),
  busy: $('busy'), busyText: $('busyText'), busyBar: $('busyBar'),
  render: $('render'), toastHost: $('toastHost')
};

const S = {
  file: null, url: null, duration: 0,
  env: null, hop: 0.05,
  clips: [], sel: null, segments: null, norm: null,
  ratio: '9:16', pan: 0.5,
  loop: true, recording: false,
  audioCtx: null, srcNode: null, streamDest: null
};

/* ---------------- utilidades ---------------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function fmt(t) {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function toast(msg, ms = 3200) {
  const n = document.createElement('div');
  n.className = 'toast';
  n.textContent = msg;
  el.toastHost.appendChild(n);
  setTimeout(() => { n.style.opacity = '0'; n.style.transform = 'translateY(10px)'; }, ms - 400);
  setTimeout(() => n.remove(), ms);
}

function busy(on, text, pct) {
  el.busy.hidden = !on;
  if (text) el.busyText.textContent = text;
  el.busyBar.style.width = `${clamp(pct ?? 0, 0, 100)}%`;
}

const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

/* ---------------- carga de archivo ---------------- */
el.drop.addEventListener('click', () => el.fileInput.click());
el.drop.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.fileInput.click(); }
});
el.btnChange.addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); });

['dragenter', 'dragover'].forEach(ev =>
  el.drop.addEventListener(ev, e => { e.preventDefault(); el.drop.classList.add('hot'); }));
['dragleave', 'drop'].forEach(ev =>
  el.drop.addEventListener(ev, e => { e.preventDefault(); el.drop.classList.remove('hot'); }));
el.drop.addEventListener('drop', e => {
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('video/')) loadFile(f);
  else toast('Ese archivo no es un video. Prueba con MP4, MOV o WebM.');
});

function loadFile(file) {
  if (S.url) URL.revokeObjectURL(S.url);
  S.file = file;
  S.url = URL.createObjectURL(file);
  S.env = null; S.clips = []; S.sel = null;

  el.video.src = S.url;
  el.fileLabel.textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`;
  el.btnAnalyze.disabled = false;
  el.btnAI.disabled = false;
  el.btnChange.hidden = false;
  el.landing.hidden = true;
  el.editor.hidden = false;
  renderClips();

  el.video.addEventListener('loadedmetadata', () => {
    S.duration = el.video.duration;
    sizeCanvas();
    drawWave();
    if (file.size > 320 * 1048576) {
      toast('El video pesa bastante. El análisis puede tardar o quedarse sin memoria.', 5200);
    }
  }, { once: true });
}

/* ---------------- análisis de audio ---------------- */
el.btnAnalyze.addEventListener('click', analyze);

async function analyze() {
  if (!S.file) return;
  busy(true, 'Leyendo la pista de audio…', 8);
  await nextFrame();

  try {
    if (!S.env) {
      const buf = await S.file.arrayBuffer();
      busy(true, 'Decodificando audio…', 32);
      await nextFrame();
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const decoded = await ac.decodeAudioData(buf);
      ac.close();
      busy(true, 'Midiendo energía…', 62);
      await nextFrame();
      S.env = envelope(decoded);
      S.duration = decoded.duration || el.video.duration;
    }

    busy(true, 'Puntuando momentos…', 86);
    await nextFrame();
    S.clips = detect(S.env, S.hop, S.duration, Number(el.clipLen.value));
    S.sel = S.clips.length ? S.clips[0].id : null;
    if (S.sel) seek(S.clips[0].start);

    busy(false);
    renderClips();
    drawWave();
    toast(S.clips.length ? `${S.clips.length} momentos encontrados.` : 'No se encontró un patrón claro. Marca los cortes a mano.');
  } catch (err) {
    console.error(err);
    busy(false);
    toast('No se pudo leer el audio de este archivo. Puedes marcar los cortes a mano.', 5200);
  }
}

function envelope(buffer) {
  const hop = S.hop;
  const sr = buffer.sampleRate;
  const step = Math.max(1, Math.floor(sr * hop));
  const ch = buffer.getChannelData(0);
  const n = Math.floor(ch.length / step);
  const out = new Float32Array(n);
  const stride = 4;
  for (let i = 0; i < n; i++) {
    let acc = 0, cnt = 0;
    const off = i * step;
    for (let j = 0; j < step; j += stride) { const v = ch[off + j]; acc += v * v; cnt++; }
    out[i] = Math.sqrt(acc / Math.max(1, cnt));
  }
  return out;
}

function smooth(arr, win) {
  const n = arr.length, out = new Float32Array(n);
  let acc = 0;
  const half = Math.max(1, Math.floor(win / 2));
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half), b = Math.min(n - 1, i + half);
    acc = 0;
    for (let k = a; k <= b; k++) acc += arr[k];
    out[i] = acc / (b - a + 1);
  }
  return out;
}

function normalize(arr) {
  const s = Array.from(arr).sort((a, b) => a - b);
  const lo = s[Math.floor(s.length * 0.08)] || 0;
  const hi = s[Math.floor(s.length * 0.95)] || 1;
  const span = (hi - lo) || 1;
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = clamp((arr[i] - lo) / span, 0, 1);
  return out;
}

/* Puntúa ventanas deslizantes: energía media, contraste interno,
   proporción de habla y arranque limpio después de un silencio. */
function detect(env, hop, duration, targetLen) {
  const sm = smooth(env, Math.round(0.8 / hop));
  const norm = normalize(sm);
  S.norm = norm;

  const n = norm.length;
  const w = Math.round(targetLen / hop);
  if (n < w * 1.4) return [];

  const SIL = 0.16;
  const stepScan = Math.max(1, Math.round(0.25 / hop));
  const cand = [];

  for (let i = 0; i + w < n; i += stepScan) {
    let sum = 0, sum2 = 0, speech = 0;
    for (let k = i; k < i + w; k++) {
      const v = norm[k];
      sum += v; sum2 += v * v;
      if (v > SIL) speech++;
    }
    const mean = sum / w;
    const varr = Math.max(0, sum2 / w - mean * mean);
    const contrast = Math.sqrt(varr);
    const ratio = speech / w;
    const cleanStart = (i > 2 && norm[i - 2] < SIL && norm[i + 2] > SIL) ? 0.09 : 0;
    const score = mean * 0.46 + contrast * 0.24 + ratio * 0.21 + cleanStart;
    cand.push({ i, score });
  }

  cand.sort((a, b) => b.score - a.score);

  const picked = [];
  const minGap = w * 0.65;
  for (const c of cand) {
    if (picked.length >= 8) break;
    if (picked.some(p => Math.abs(p.i - c.i) < minGap)) continue;
    picked.push(c);
  }
  picked.sort((a, b) => a.i - b.i);

  const top = picked[0] ? picked[0].score : 1;
  const bottom = picked[picked.length - 1] ? picked[picked.length - 1].score : 0;

  return picked.map((c, idx) => {
    let s = snap(norm, c.i, w * 0.08, SIL);
    let e = snap(norm, c.i + w, w * 0.08, SIL);
    const start = clamp(s * hop, 0, duration - 2);
    const end = clamp(Math.max(start + 4, e * hop), 0, duration);
    const rel = (c.score - bottom) / ((top - bottom) || 1);
    return {
      id: `c${idx}_${Math.round(start * 100)}`,
      start, end,
      score: Math.round(58 + rel * 40),
      title: labelFor(norm, c.i, w, duration, start, idx)
    };
  });
}

/* Mueve el borde al punto más silencioso dentro de una ventana pequeña. */
function snap(norm, idx, radius, SIL) {
  const a = Math.max(0, Math.round(idx - radius));
  const b = Math.min(norm.length - 1, Math.round(idx + radius));
  let best = idx, bestV = Infinity;
  for (let k = a; k <= b; k++) {
    if (norm[k] < bestV) { bestV = norm[k]; best = k; }
    if (norm[k] < SIL * 0.7) { best = k; break; }
  }
  return best;
}

function labelFor(norm, i, w, duration, start, idx) {
  const head = avg(norm, i, i + Math.round(w * 0.2));
  const tail = avg(norm, i + Math.round(w * 0.8), i + w);
  let kind = 'Bloque sostenido';
  if (head > tail * 1.35) kind = 'Arranque fuerte';
  else if (tail > head * 1.35) kind = 'Remate en alto';
  else if (start < duration * 0.12) kind = 'Gancho de apertura';
  else if (start > duration * 0.82) kind = 'Cierre';
  return `${String(idx + 1).padStart(2, '0')} · ${kind}`;
}

function avg(arr, a, b) {
  a = Math.max(0, a); b = Math.min(arr.length, b);
  let s = 0; for (let k = a; k < b; k++) s += arr[k];
  return s / Math.max(1, b - a);
}

/* ---------------- onda y timeline ---------------- */
let waveW = 0, waveH = 150;

function sizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const r = el.wave.getBoundingClientRect();
  waveW = r.width || 800;
  el.wave.width = Math.round(waveW * dpr);
  el.wave.height = Math.round(waveH * dpr);
  const ctx = el.wave.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', () => { sizeCanvas(); drawWave(); });

function drawWave() {
  const ctx = el.wave.getContext('2d');
  ctx.clearRect(0, 0, waveW, waveH);

  const mid = waveH / 2;
  const data = S.norm || S.env;

  if (data && data.length) {
    const bars = Math.floor(waveW / 3);
    const per = data.length / bars;
    const grad = ctx.createLinearGradient(0, 0, waveW, 0);
    grad.addColorStop(0, 'rgba(143,176,255,.85)');
    grad.addColorStop(.5, 'rgba(122,86,240,.85)');
    grad.addColorStop(1, 'rgba(49,214,198,.85)');
    ctx.fillStyle = grad;
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, data[i]);
    for (let b = 0; b < bars; b++) {
      let m = 0;
      for (let k = Math.floor(b * per); k < Math.floor((b + 1) * per); k++) m = Math.max(m, data[k] || 0);
      const h = Math.max(1.5, (m / (peak || 1)) * (waveH * 0.42));
      ctx.fillRect(b * 3, mid - h, 2, h * 2);
    }
  } else {
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    ctx.fillRect(0, mid - 1, waveW, 2);
    ctx.fillStyle = 'rgba(232,236,251,.35)';
    ctx.font = '12px Montserrat, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Pulsa "Buscar momentos" para leer el audio', waveW / 2, mid - 14);
  }

  // regiones de clips
  S.clips.forEach(c => {
    const x1 = (c.start / S.duration) * waveW;
    const x2 = (c.end / S.duration) * waveW;
    const on = c.id === S.sel;
    ctx.fillStyle = on ? 'rgba(95,139,255,.24)' : 'rgba(255,255,255,.07)';
    ctx.fillRect(x1, 0, x2 - x1, waveH);
    ctx.fillStyle = on ? 'rgba(200,218,255,.95)' : 'rgba(255,255,255,.35)';
    ctx.fillRect(x1 - 1, 0, 2.5, waveH);
    ctx.fillRect(x2 - 1, 0, 2.5, waveH);
    if (on) {
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.fillRect(x1 - 1, waveH / 2 - 14, 2.5, 28);
      ctx.fillRect(x2 - 1, waveH / 2 - 14, 2.5, 28);
    }
  });
}

/* arrastre sobre la onda */
let drag = null;

el.wave.addEventListener('pointerdown', e => {
  const rect = el.wave.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const t = (x / rect.width) * S.duration;
  const c = S.clips.find(k => k.id === S.sel);

  if (c) {
    const x1 = (c.start / S.duration) * rect.width;
    const x2 = (c.end / S.duration) * rect.width;
    if (Math.abs(x - x1) < 12) drag = { mode: 'start', c };
    else if (Math.abs(x - x2) < 12) drag = { mode: 'end', c };
  }
  if (!drag) seek(t);
  el.wave.setPointerCapture(e.pointerId);
});

el.wave.addEventListener('pointermove', e => {
  const rect = el.wave.getBoundingClientRect();
  const t = clamp(((e.clientX - rect.left) / rect.width) * S.duration, 0, S.duration);
  if (!drag) {
    const c = S.clips.find(k => k.id === S.sel);
    if (c) {
      const x = e.clientX - rect.left;
      const x1 = (c.start / S.duration) * rect.width;
      const x2 = (c.end / S.duration) * rect.width;
      el.wave.style.cursor = (Math.abs(x - x1) < 12 || Math.abs(x - x2) < 12) ? 'ew-resize' : 'crosshair';
    }
    return;
  }
  if (drag.mode === 'start') drag.c.start = clamp(t, 0, drag.c.end - 2);
  else drag.c.end = clamp(t, drag.c.start + 2, S.duration);
  drawWave();
  renderClips();
});

['pointerup', 'pointercancel'].forEach(ev => el.wave.addEventListener(ev, () => {
  if (drag) { seek(drag.mode === 'start' ? drag.c.start : Math.max(0, drag.c.end - 1)); }
  drag = null;
}));

/* ---------------- reproducción ---------------- */
function seek(t) {
  el.video.currentTime = clamp(t, 0, Math.max(0, S.duration - 0.05));
  updateHead();
}

el.btnPlay.addEventListener('click', () => {
  if (el.video.paused) {
    const c = current();
    if (c && (el.video.currentTime < c.start - 0.3 || el.video.currentTime > c.end)) seek(c.start);
    el.video.play();
  } else el.video.pause();
});

el.video.addEventListener('play', () => { el.btnPlay.textContent = '❚❚'; if (S.audioCtx) S.audioCtx.resume(); });
el.video.addEventListener('pause', () => { el.btnPlay.textContent = '▶'; });
el.video.addEventListener('timeupdate', updateHead);

function updateHead() {
  const c = current();
  if (!S.recording && S.loop && c && !el.video.paused && el.video.currentTime >= c.end) {
    seek(c.start);
  }
  const seg = segmentAt(el.video.currentTime);
  el.cap.hidden = !seg;
  if (seg) el.cap.textContent = seg.text;

  const p = S.duration ? el.video.currentTime / S.duration : 0;
  el.playhead.style.left = `${p * 100}%`;
  el.timeNow.textContent = c
    ? `${fmt(el.video.currentTime)} / ${fmt(c.end - c.start)}`
    : `${fmt(el.video.currentTime)} / ${fmt(S.duration)}`;
}

const current = () => S.clips.find(c => c.id === S.sel) || null;

function segmentAt(t) {
  if (!S.segments) return null;
  return S.segments.find(s => t >= s.start && t <= s.end) || null;
}

/* ---------------- formato y encuadre ---------------- */
document.querySelectorAll('.chip').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(b => b.classList.toggle('is-on', b === btn));
    S.ratio = btn.dataset.ratio;
    el.frame.dataset.ratio = S.ratio;
  });
});

el.panX.addEventListener('input', () => {
  S.pan = Number(el.panX.value) / 100;
  el.video.style.objectPosition = `${S.pan * 100}% 50%`;
});

/* ---------------- lista de clips ---------------- */
function renderClips() {
  el.clipList.innerHTML = '';
  el.emptyClips.hidden = S.clips.length > 0;
  el.btnExport.disabled = !S.clips.length;
  el.btnJSON.disabled = !S.clips.length;

  const act = current();
  el.hook.hidden = !act;
  if (act) el.hook.textContent = act.title;

  S.clips.sort((a, b) => a.start - b.start).forEach(c => {
    const node = document.createElement('div');
    node.className = 'clip' + (c.id === S.sel ? ' is-on' : '');

    const top = document.createElement('div');
    top.className = 'clip-top';
    const input = document.createElement('input');
    input.className = 'clip-title';
    input.value = c.title;
    input.addEventListener('input', () => { c.title = input.value; el.hook.textContent = input.value; });
    input.addEventListener('click', e => e.stopPropagation());
    const sc = document.createElement('span');
    sc.className = 'score' + (c.score < 78 ? ' mid' : '');
    sc.textContent = c.score;
    top.append(input, sc);

    const meta = document.createElement('div');
    meta.className = 'clip-meta';
    meta.innerHTML = `<span>${fmt(c.start)} → ${fmt(c.end)}</span><span class="sep">|</span><span>${(c.end - c.start).toFixed(1)} s</span>`;

    const bar = document.createElement('div');
    bar.className = 'clip-bar';
    bar.innerHTML = `<i style="width:${c.score}%"></i>`;

    node.append(top, meta, bar);
    node.addEventListener('click', () => {
      S.sel = c.id;
      seek(c.start);
      renderClips(); drawWave();
    });
    el.clipList.appendChild(node);
  });
}

el.btnManual.addEventListener('click', () => {
  const len = Number(el.clipLen.value);
  const start = clamp(el.video.currentTime, 0, Math.max(0, S.duration - 5));
  const c = {
    id: 'm' + Date.now(),
    start,
    end: clamp(start + len, start + 5, S.duration),
    score: 70,
    title: `${String(S.clips.length + 1).padStart(2, '0')} · Corte manual`
  };
  S.clips.push(c);
  S.sel = c.id;
  renderClips(); drawWave();
});

el.clipLen.addEventListener('change', () => { if (S.env) analyze(); });

el.btnJSON.addEventListener('click', () => {
  const data = {
    source: S.file ? S.file.name : '',
    duration: Number(S.duration.toFixed(2)),
    ratio: S.ratio,
    clips: S.clips.map(c => ({
      title: c.title,
      start: Number(c.start.toFixed(2)),
      end: Number(c.end.toFixed(2)),
      seconds: Number((c.end - c.start).toFixed(2)),
      score: c.score
    }))
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  download(blob, 'glasscut-marcas.json');
  toast('Marcas descargadas.');
});

/* ---------------- exportación ---------------- */
el.btnExport.addEventListener('click', exportClip);

function pickMime() {
  const opts = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  return opts.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}

function ensureAudioGraph() {
  if (S.streamDest) return;
  try {
    S.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    S.srcNode = S.audioCtx.createMediaElementSource(el.video);
    S.streamDest = S.audioCtx.createMediaStreamDestination();
    S.srcNode.connect(S.audioCtx.destination);
    S.srcNode.connect(S.streamDest);
  } catch (err) {
    console.warn('Audio no enrutado, se exporta sin pista de sonido.', err);
  }
}

function outSize() {
  if (S.ratio === '9:16') return { w: 720, h: 1280 };
  if (S.ratio === '1:1') return { w: 1000, h: 1000 };
  return { w: 1280, h: 720 };
}

async function exportClip() {
  const c = current();
  if (!c) return;
  if (!window.MediaRecorder) { toast('Este navegador no permite grabar. Usa Chrome o Edge.'); return; }

  const mime = pickMime();
  const { w, h } = outSize();
  const cv = el.render;
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');

  ensureAudioGraph();
  if (S.audioCtx && S.audioCtx.state === 'suspended') await S.audioCtx.resume();

  const stream = cv.captureStream(30);
  if (S.streamDest) {
    const at = S.streamDest.stream.getAudioTracks()[0];
    if (at) stream.addTrack(at);
  }

  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 5_000_000 } : undefined);
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

  const done = new Promise(res => { rec.onstop = res; });

  S.recording = true;
  el.video.pause();
  el.video.currentTime = c.start;
  await new Promise(r => el.video.addEventListener('seeked', r, { once: true }));

  const total = c.end - c.start;
  busy(true, 'Grabando el clip en tiempo real…', 0);

  rec.start(200);
  await el.video.play();

  let stop = false;
  const paint = () => {
    if (stop) return;
    drawFrame(ctx, w, h, c.title);
    const pct = ((el.video.currentTime - c.start) / total) * 100;
    el.busyBar.style.width = `${clamp(pct, 0, 100)}%`;
    if (el.video.currentTime >= c.end) {
      stop = true;
      el.video.pause();
      rec.stop();
      return;
    }
    requestAnimationFrame(paint);
  };
  requestAnimationFrame(paint);

  await done;
  S.recording = false;
  busy(false);

  const type = mime || 'video/webm';
  const ext = type.includes('mp4') ? 'mp4' : 'webm';
  const name = `${(S.file.name || 'clip').replace(/\.[^.]+$/, '')}-${Math.round(c.start)}s.${ext}`;
  download(new Blob(chunks, { type }), name);
  toast(`Clip exportado: ${name}`, 4200);
}

function drawFrame(ctx, w, h, title) {
  const v = el.video;
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw) return;

  const target = w / h;
  let sw = vw, sh = vh;
  if (vw / vh > target) sw = vh * target; else sh = vw / target;
  const sx = clamp((vw - sw) * S.pan, 0, vw - sw);
  const sy = (vh - sh) / 2;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h);

  if (title) {
    const size = Math.round(w * 0.062);
    ctx.font = `700 ${size}px Montserrat, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,.75)';
    ctx.shadowBlur = size * 0.45;
    ctx.fillStyle = '#fff';
    wrapText(ctx, title, w / 2, h * 0.07, w * 0.86, size * 1.2);
    ctx.shadowBlur = 0;
  }

  const seg = segmentAt(v.currentTime);
  if (seg) {
    const cs = Math.round(w * 0.048);
    ctx.font = `500 ${cs}px Montserrat, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.shadowColor = 'rgba(0,0,0,.9)';
    ctx.shadowBlur = cs * 0.6;
    ctx.fillStyle = '#fff';
    wrapBottom(ctx, seg.text, w / 2, h * 0.88, w * 0.86, cs * 1.25);
    ctx.shadowBlur = 0;
  }
}

function wrapBottom(ctx, text, x, y, maxW, lh) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; }
    else line = test;
  }
  if (line) lines.push(line);
  const keep = lines.slice(-2);
  keep.forEach((l, i) => ctx.fillText(l, x, y - (keep.length - 1 - i) * lh));
}

function wrapText(ctx, text, x, y, maxW, lh) {
  const words = String(text).split(' ');
  let line = '', row = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + row * lh);
      line = word; row++;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y + row * lh);
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

/* ---------------- atajos ---------------- */
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); el.btnPlay.click(); }
  if (e.key === 'ArrowRight') seek(el.video.currentTime + 2);
  if (e.key === 'ArrowLeft') seek(el.video.currentTime - 2);
});

window.GC = {
  S,
  seek, busy, toast,
  renderClips, drawWave
};
S.seek = seek;

sizeCanvas();
drawWave();
