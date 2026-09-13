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
