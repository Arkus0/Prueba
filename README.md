# OCR → IA · Respuestas automáticas en directo

Aplicación web que corre **en el mismo PC** que muestra las respuestas: una webcam
apunta a la pantalla donde aparecen las preguntas (pensado para charlas, con
frecuencia de filosofía, aunque sirve para cualquier temática), el OCR lee el texto
y, cuando aparece una **pregunta** (normal o tipo test), se envía automáticamente al
LLM configurado y la respuesta se muestra en grande en este PC. Sin botón "Enviar":
todo es automático tras pulsar *Iniciar cámara*.

```
webcam del PC → zona seleccionable → OCR (Tesseract.js, spa+eng)
      → estabilización y agrupación (los tests A/B/C/D van juntos en una sola pregunta)
      → deduplicación → cola pequeña → LLM (API OpenAI-compatible) → tarjeta RESPUESTA / EXPLICACIÓN
```

## Puesta en marcha

1. **Arranca la app** en el PC con webcam:

   ```
   doble clic en servir.bat
   ```

   Se abre `http://localhost:8000` en el navegador (si no se abre solo, ábrelo a mano).
   No hace falta HTTPS ni abrir puertos: `localhost` ya es un origen seguro para usar
   la cámara. Si quieres usarla desde otro dispositivo de la WiFi, ejecuta
   `python servir.py --https` (certificado autofirmado; ver más abajo).

2. **Configura el LLM**: toca **⚙ Ajustes** y rellena:

   | Campo | OpenAI | Groq | OpenRouter | Ollama (local, en este PC) |
   |---|---|---|---|---|
   | URL base | `https://api.openai.com/v1` | `https://api.groq.com/openai/v1` | `https://openrouter.ai/api/v1` | `http://localhost:11434/v1` |
   | Modelo | `gpt-4o-mini` | `llama-3.1-8b-instant` | cualquiera del catálogo | el que tengas descargado |
   | API key | tu clave | tu clave | tu clave | (vacío) |

   Para Ollama, arranca el servidor con `OLLAMA_ORIGINS=* ollama serve` para aceptar
   peticiones desde el navegador. En **Cámara** elige la webcam concreta si hay varias
   (tras cambiarla, recarga la página). La clave se guarda **solo en el navegador de
   este PC**.

3. **Inicia**: pulsa *Iniciar cámara*, concede el permiso, apunta la webcam a la
   pantalla con las preguntas y ajusta el recuadro verde con el ratón para ceñirlo a
   la zona de la pregunta. A partir de ahí no hace falta tocar nada.

> Consejo de colocación: si la webcam ve la misma pantalla donde se muestran las
> respuestas, la app no se auto-contesta por error (el texto "RESPUESTA: …" se
> clasifica como mensaje, no como pregunta), pero es más limpio apuntar la cámara a
> la pantalla de la presentación y dejar las respuestas en la otra.

## Cómo se comporta

- **Preguntas tipo test**: las opciones `A) … B) … C) … D) …` se agrupan con su
  enunciado en una sola pregunta (aunque aparezcan por fases en pantalla) y se envían
  juntas al modelo, que responde **solo con la opción elegida** (p. ej.
  `RESPUESTA: C) Mercurio`), sin explicación, para leerse de un vistazo.
- **Varias preguntas a la vez**: si en pantalla hay 3, 4 o más preguntas apiladas
  (numeradas «1.», «2.» o simplemente seguidas), se separan, se rastrea cada una por
  separado y se consulta el modelo una vez por pregunta (en orden, hasta 8 en cola).
  Las respuestas van apareciendo en la tarjeta y quedan en el historial.
- **Preguntas normales**: se responden directamente en 1-3 frases.
- **Sin duplicados**: una pregunta que sigue en pantalla no se consulta dos veces.
  Si reaparece, se vuelve a mostrar la respuesta en caché.
- **Revisión**: si se envió una pregunta y después aparecen más opciones (o la
  pregunta simple gana opciones), se hace una única consulta de revisión con el
  contenido completo (se marca como "actualizada con opciones").
- **Cola pequeña**: si se acumulan preguntas, se procesan en orden con un máximo de
  8 pendientes; las más antiguas se descartan (quedan registradas en el log).
- **Nueva sesión (↻)**: olvida las preguntas ya respondidas y el historial — úsalo
  al empezar otra presentación.
- **☰** muestra el OCR crudo (con confianza) y el log de eventos, útil para ajustar
  la webcam o la zona de captura.

## Ajustes disponibles

URL base, modelo, clave, cámara y periodo de escaneo (ms, por defecto 2000). Baja el
periodo si quieres respuestas más rápidas a costa de CPU; súbelo si el PC va justo.

## Consejos de calidad del OCR

- Enfoca bien: muchas webcams permiten ajustar el enfoque girando el aro del objetivo.
- Evita reflejos y ángulos muy oblicuos; la cámara casi frontal funciona mejor.
- Usa el recuadro de captura para limitar la zona a la pregunta (menos ruido de OCR).
- El primer arranque del motor OCR tarda unos segundos (carga de idiomas spa+eng).

## Uso desde otro dispositivo (opcional)

`python servir.py --https` sirve la app por HTTPS con cert autofirmado (imprescindible
para la cámara fuera de localhost). El móvil mostrará un aviso → *Configuración
avanzada* → *Continuar*. Alternativa con HTTP: activar en Chrome el flag
`chrome://flags/#unsafely-treat-insecure-origin-as-secure` con
`http://<IP-DEL-PC>:8000`. Si el Firewall bloquea el acceso (PowerShell admin):

```
netsh advfirewall firewall add rule name="ocr-qa" dir=in action=allow protocol=TCP localport=8443
```

## Desarrollo

- `js/logic.js` es lógica pura sin DOM. Tests: `node --test tests/logic.test.mjs`
  (desde la carpeta del proyecto).
- Hook de depuración en consola del navegador:
  `window.__pipeline.feed("texto simulado")` inyecta un ciclo de OCR falso;
  `window.__pipeline.setLlm(async () => "RESPUESTA: …")` sustituye el LLM por un mock.
- Dependencias (Tesseract.js + modelos spa/eng) están en `vendor/`: la app no
  necesita internet salvo para llamar al LLM.

## Estructura

```
index.html      UI (arranque, cámara, tarjeta de respuesta, historial, ajustes)
styles.css      tema oscuro con letra grande, layout de dos columnas en escritorio
js/logic.js     normalización OCR, agrupación de tests, dedup, cola (puro, testeado)
js/ocr.js       worker Tesseract + preprocesado (recorte, escala, contraste)
js/llm.js       cliente OpenAI-compatible + ajustes persistidos (incluye cámara)
js/ui.js        render de estado, tarjeta, historial y depuración
js/main.js      cámara, bucle de OCR, eventos y cableado general
vendor/         tesseract.js, wasm y traineddata spa/eng (locales)
tests/          tests Node de la lógica pura
servir.py/.bat  servidor local (HTTP por defecto, --https opcional)
```
