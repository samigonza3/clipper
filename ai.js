/* GlassCut — capa de IA.
   El navegador extrae el audio, lo parte y lo manda a las Netlify Functions.
   La API key nunca sale del servidor. */

const CHUNK_SECONDS = 90;     // trozos cortos para no pasar el timeout de la función
const SAMPLE_RATE = 16000;    // Whisper trabaja a 16 kHz mono, más es desperdicio
const CONCURRENCY = 3;

const AI = {
  async run() {
    const G = window.GC;
    if (!G || !G.S.file) return;
    const S = G.S;

    try {
      G.busy(true, 'Extrayendo el audio…', 4);
      const mono = await extractMono(S.file);

      const chunks = sliceChunks(mono, SAMPLE_RATE, CHUNK_SECONDS);
      G.busy(true, `Transcribiendo ${chunks.length} trozos…`, 12);

      let done = 0;
      const segments = await pool(chunks, CONCURRENCY, async (chunk) => {
        const res = await post('/.netlify/functions/transcribe', {
          audio: toBase64(encodeWav(chunk.data, SAMPLE_RATE)),
          offset: chunk.offset
        });
        done++;
        G.busy(true, `Transcribiendo ${done} de ${chunks.length}…`, 12 + (done / chunks.length) * 58);
        return res.segments || [];
      });

      const flat = segments.flat().sort((a, b) => a.start - b.start);
      if (!flat.length) throw new Error('La transcripción salió vacía');
      S.segments = flat;

      G.busy(true, 'Eligiendo los mejores momentos…', 82);
      const { clips } = await post('/.netlify/functions/rank', {
        segments: flat,
        target: Number(document.getElementById('clipLen').value),
        count: 6
      });

      if (!clips || !clips.length) throw new Error('El modelo no devolvió clips');

      S.clips = clips.map((c, i) => ({
        id: `ai${i}_${Math.round(c.start * 100)}`,
        start: Math.max(0, c.start),
        end: Math.min(S.duration, c.end),
        score: blend(c.score, c.start, c.end),
        title: c.title,
        reason: c.reason
      }));
      S.sel = S.clips[0].id;
      S.seek(S.clips[0].start);

      G.busy(false);
      G.renderClips();
      G.drawWave();
      G.toast(`${S.clips.length} clips elegidos por contenido, con subtítulos listos.`, 4200);
    } catch (err) {
      console.error(err);
      G.busy(false);
      G.toast(err.message || 'Falló el análisis con IA. Revisa la consola.', 5200);
    }
  }
};

/* Mezcla el criterio del modelo con la energía del audio.
   El modelo sabe qué se dice; la onda sabe cómo se dice. */
function blend(aiScore, start, end) {
  const S = window.GC.S;
  if (!S.norm) return Math.round(aiScore);
  const a = Math.floor(start / S.hop), b = Math.floor(end / S.hop);
  let sum = 0, n = 0;
  for (let i = a; i < b && i < S.norm.length; i++) { sum += S.norm[i]; n++; }
  const energy = n ? (sum / n) * 100 : 70;
  return Math.round(aiScore * 0.72 + energy * 0.28);
}

/* Decodifica el archivo y lo baja a mono 16 kHz en una sola pasada. */
async function extractMono(file) {
  const ab = await file.arrayBuffer();
  const tmp = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await tmp.decodeAudioData(ab);
  tmp.close();

  const frames = Math.ceil(decoded.duration * SAMPLE_RATE);
  const off = new OfflineAudioContext(1, frames, SAMPLE_RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0);
}

function sliceChunks(data, rate, seconds) {
  const size = rate * seconds;
  const out = [];
  for (let i = 0; i < data.length; i += size) {
    out.push({ offset: i / rate, data: data.subarray(i, Math.min(i + size, data.length)) });
  }
  return out;
}

function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };

  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);

  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Uint8Array(buf);
}

function toBase64(bytes) {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

/* Lanza N peticiones a la vez y mantiene el orden de los resultados. */
async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btnAI');
  if (btn) btn.addEventListener('click', () => AI.run());
});
