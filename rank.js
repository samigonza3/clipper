// Recibe la transcripción con timestamps y devuelve los clips que valen la pena.
// El modelo decide por contenido; el navegador ya decidió por energía.

const SYSTEM = `Eres editor de video corto. Recibes la transcripción de un video largo con marcas de tiempo.
Tu trabajo es elegir los fragmentos que funcionan como clip independiente para TikTok, Reels o Shorts.

Un buen clip cumple tres cosas: se entiende sin ver el resto del video, tiene una idea completa con principio y final, y contiene algo que genera reacción, o sea una afirmación fuerte, un dato que sorprende, una historia corta, una opinión incómoda o un consejo concreto.

Descarta presentaciones, saludos, transiciones administrativas y tramos donde solo se confirma lo que ya se dijo.

Devuelve SOLO un array JSON, sin markdown, sin explicación fuera del JSON. Cada elemento:
{"start": segundos decimales, "end": segundos decimales, "title": "gancho de máximo 45 caracteres en el idioma del video", "reason": "por qué funciona, máximo 90 caracteres", "score": entero de 0 a 100}

Reglas: el clip debe durar entre MINLEN y MAXLEN segundos. start y end deben caer en los bordes de los segmentos que recibes. No devuelvas clips solapados. Ordena por score descendente. Máximo COUNT clips.`;

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const key = process.env.OPENAI_API_KEY;
  if (!key) return json({ error: 'Falta OPENAI_API_KEY en las variables de entorno' }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Cuerpo inválido' }, 400); }

  const { segments = [], target = 30, count = 6 } = body;
  if (!segments.length) return json({ error: 'No hay transcripción para analizar' }, 400);

  const minLen = Math.max(10, Math.round(target * 0.6));
  const maxLen = Math.round(target * 1.8);

  const system = SYSTEM
    .replace('MINLEN', minLen)
    .replace('MAXLEN', maxLen)
    .replace('COUNT', count);

  const transcript = segments
    .map(s => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`)
    .join('\n')
    .slice(0, 90000);

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system + '\nEnvuelve el array en un objeto con la clave "clips".' },
        { role: 'user', content: transcript }
      ]
    })
  });

  if (!res.ok) {
    const detail = await res.text();
    return json({ error: 'El modelo rechazó la petición', detail: detail.slice(0, 400) }, res.status);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '{}';

  let clips = [];
  try {
    const parsed = JSON.parse(raw);
    clips = Array.isArray(parsed) ? parsed : (parsed.clips || parsed.results || []);
  } catch {
    return json({ error: 'El modelo devolvió un JSON que no se pudo leer' }, 502);
  }

  clips = clips
    .filter(c => typeof c.start === 'number' && typeof c.end === 'number' && c.end > c.start)
    .map(c => ({
      start: Number(c.start.toFixed(2)),
      end: Number(c.end.toFixed(2)),
      title: String(c.title || 'Clip').slice(0, 60),
      reason: String(c.reason || '').slice(0, 120),
      score: Math.round(Math.min(100, Math.max(0, Number(c.score) || 70)))
    }))
    .slice(0, count);

  return json({ clips, usage: data.usage || null });
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
