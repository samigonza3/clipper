# GlassCut

Prototipo de clipping de video que corre 100% en el navegador. Subes un video, la app
lee la pista de audio completa, puntúa ventanas deslizantes y propone los cortes con
mayor probabilidad de funcionar como clip corto. No hay backend ni subida de archivos.

## Qué hace

Lee el audio con Web Audio API y construye una envolvente de energía cada 50 ms.
Suaviza y normaliza esa envolvente por percentiles para ignorar el ruido de fondo.
Puntúa cada ventana del largo elegido (15, 30, 45 o 60 s) combinando energía media,
contraste interno, proporción de habla y bonificación por arranque limpio tras un silencio.
Aplica supresión de no máximos para que los clips no se solapen.
Ajusta los bordes al punto más silencioso cercano para que el corte no parta una palabra.
Permite mover los bordes a mano sobre la onda, elegir formato 9:16, 1:1 o 16:9,
mover el encuadre horizontal y quemar el hook sobre el video.
Exporta el clip con MediaRecorder y descarga las marcas en JSON.

## Limitaciones del prototipo

La exportación graba en tiempo real, así que un clip de 30 s tarda 30 s.
El formato de salida es MP4 en Safari y WebM en Chrome o Firefox.
No hay transcripción ni face tracking todavía. La siguiente iteración natural es
Whisper en WebGPU para subtítulos y scoring semántico, y ffmpeg.wasm para cortar sin grabar.

## Correr en local

Cualquier servidor estático sirve:

    python3 -m http.server 5173

Luego abre http://localhost:5173

## Deploy en Netlify

Conecta el repositorio en Netlify. Sin comando de build, carpeta de publicación la raíz.
El archivo netlify.toml ya lo deja configurado.

## Capa de IA

El botón "Analizar con IA" hace esto, en este orden:

El navegador decodifica el audio, lo baja a mono 16 kHz y lo parte en trozos de 90 segundos.
Cada trozo se manda como WAV en base64 a /.netlify/functions/transcribe, de a tres en paralelo.
Esa función llama a Whisper y devuelve segmentos con timestamps, ya corregidos al tiempo absoluto del video.
La transcripción completa va a /.netlify/functions/rank, que le pide al modelo los mejores fragmentos
con gancho, razón y puntaje en JSON.
El puntaje final mezcla 72% criterio del modelo y 28% energía del audio.
Los segmentos quedan disponibles como subtítulos, que se ven en el preview y se queman al exportar.

### Variables de entorno en Netlify

    OPENAI_API_KEY   obligatoria
    OPENAI_MODEL     opcional, por defecto gpt-4o-mini

Se configuran en Site configuration, Environment variables. Nunca en el código.

### Costo aproximado

Whisper cobra 0.006 USD por minuto de audio. Un video de 20 minutos cuesta 0.12 USD transcribirlo.
El ranking con gpt-4o-mini sobre una transcripción de 20 minutos ronda 0.01 USD.
Total, unos 0.13 USD por video, contra 0.25 USD de Ssemble en su plan más barato.

### Probar en local

Con la CLI de Netlify, porque las funciones necesitan runtime:

    npm i -g netlify-cli
    netlify dev

Crea un archivo .env con OPENAI_API_KEY=sk-... y no lo subas al repo.
