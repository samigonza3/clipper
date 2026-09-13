// Proxy a OpenAI Whisper. La API key vive aquí, nunca en el navegador.
// Recibe un trozo de audio WAV en base64 y devuelve segmentos con timestamps absolutos.

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const key = process.env.OPENAI_API_KEY;
  if (!key) return json({ error: 'Falta OPENAI_API_KEY en las variables de entorno' }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Cuerpo inválido' }, 400); }

  const { audio, offset = 0, language } = body;
  if (!audio) return json({ error: 'Falta el audio' }, 400);

  const bytes = Uint8Array.from(atob(audio), c => c.charCodeAt(0));

  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'chunk.wav');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  if (language) form.append('language', language);

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form
  });

  if (!res.ok) {
    const detail = await res.text();
    return json({ error: 'Whisper rechazó la petición', detail: detail.slice(0, 400) }, res.status);
  }

  const data = await res.json();
  const segments = (data.segments || []).map(s => ({
    start: Number((s.start + offset).toFixed(2)),
    end: Number((s.end + offset).toFixed(2)),
    text: (s.text || '').trim()
  }));

  return json({ segments, language: data.language || null });
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
