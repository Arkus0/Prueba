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

2. **Configura el LLM**: la app viene preparada por defecto para **OpenRouter +
   Claude Sonnet 5.5**:

   - URL base: `https://openrouter.ai/api/v1`
   - Modelo: `anthropic/claude-sonnet-5.5`
   - Esfuerzo de razonamiento: **alto**
   - Salida máxima: 1200 tokens (la respuesta final sigue siendo breve por prompt)

   Solo tienes que introducir tu clave `sk-or-v1-...`. En Ajustes puedes cambiar el
   esfuerzo a bajo/medio/máximo o usar cualquier otro endpoint OpenAI-compatible.
   **Máximo** prioriza calidad sobre latencia; para una charla en directo recomendamos
   **alto**. La clave se guarda solo en el navegador de este PC.

   Para Ollama, arranca el servidor con `OLLAMA_ORIGINS=* ollama serve` si decides
   cambiar a un modelo local. En **Cámara** elige la webcam concreta si hay varias.

3. **Inicia**: pulsa *Iniciar cámara*, concede el permiso, apunta la webcam a la
   pantalla con las preguntas y ajusta el recuadro verde con el ratón para ceñirlo a
   la zona de la pregunta. A partir de ahí no hace falta tocar nada.

> Consejo de colocación: si la webcam ve la misma pantalla donde se muestran las
> respuestas, la app no se auto-contesta por error (el texto "RESPUESTA: …" se
> clasifica como mensaje, no como pregunta), pero es más limpio apuntar la cámara a
> la pantalla de la presentación y dejar las respuestas en la otra.

## Cómo se comporta

- **UI para auditorio**: la respuesta lógicamente más reciente ocupa la zona principal
  con tipografía muy grande. Debajo hay un **carril horizontal con toda la sesión**:
  preguntas antiguas a la izquierda y nuevas a la derecha. El carril se desplaza
  automáticamente al extremo derecho y puede recorrerse con la rueda del ratón.
- **Preguntas tipo test**: las opciones `A) … B) … C) … D) …` se agrupan con su
  enunciado en una sola pregunta (aunque aparezcan por fases en pantalla) y se envían
  juntas al modelo, que responde **solo con la opción elegida** (p. ej.
  `RESPUESTA: C) Mercurio`), sin explicación, para leerse de un vistazo.
- **Tests en lotes**: diseñado para cuestionarios de 40-50 preguntas que aparecen en
  lotes de 3-4 cada ~10 s. Las preguntas numeradas con número distinto jamás se
  consideran duplicadas, aunque compartan enunciado corto y opciones idénticas.
- **Varias preguntas a la vez**: si en pantalla hay 3, 4 o más preguntas apiladas
  (numeradas «1.», «2.» o simplemente seguidas), se separan, se rastrea cada una por
  separado y se consulta el modelo una vez por pregunta (en orden, hasta 8 en cola y
  2 consultas simultáneas). En pantallas de cuestionario con preguntas numeradas se
  analiza la estructura por bloques: las líneas de instrucción («Seleccione la
  respuesta adecuada») separan enunciado de opciones, las opciones **sin letra**
  reciben letras sintetizadas (A, B, C…) y el ruido de interfaz (URLs del navegador,
  relojes) se descarta.
- **Preguntas normales**: se responden directamente en 1-3 frases; varias preguntas
  simples simultáneas se tratan por separado.
- **Sin duplicados ni preguntas muertas**: una pregunta que sigue en pantalla no se
  consulta dos veces (si reaparece, se re-muestra la respuesta en caché). Si una
  consulta al LLM **falla** o la pregunta se descarta por cola llena, queda marcada
  para reintentarse cuando reaparezca.
- **Respuestas bloqueadas**: la respuesta a una pregunta tipo test se marca
  «🔒 respuesta bloqueada» con su hora. Si después aparecen más opciones, la revisión
  se guarda en el historial pero **no sustituye la tarjeta**, de modo que el público
  ve lo que la IA respondió antes de conocer el resultado.
- **Modo presentación (▶)**: pantalla completa con una respuesta focal enorme y el
  carril cronológico visible en la parte inferior. Se ocultan cámara y controles
  (Esc o «✕ Salir» para volver). Ideal para proyectar en auditorios.
- **Nueva sesión (↻)**: aborta las consultas en curso, descarta sus resultados y
  olvida las preguntas ya respondidas — úsalo al empezar otra presentación.
- **☰** muestra el OCR crudo (con confianza) y el log de eventos, útil para ajustar
  la webcam o la zona de captura.

## Fiabilidad del OCR

- Cada grupo acumula **votos por texto** (consenso): si el OCR alterna
  «Kant → Kani → Kant», gana la lectura más repetida.
- La **confianza** de Tesseract gobierna la finalización: por debajo de ~55% la
  pregunta espera lecturas mejores; entre 55-75% se exige estabilidad real (dos
  lecturas iguales) en vez del temporizador.
- **CPU + estabilidad**: en reposo se compara la zona de captura cada ~700 ms. Cuando
  cambia, se fuerza una pequeña ráfaga de OCR de confirmación aunque la imagen vuelva
  a quedar quieta; mientras haya una pregunta abierta también se siguen tomando
  lecturas hasta estabilizarla. En reposo hay un watchdog ocasional para no perder cambios.
- Motor **Tesseract.js 7** (wasm local en `vendor/`, spa+eng).

## Ajustes disponibles

URL base, modelo, clave, cámara y periodo de escaneo (ms, por defecto 1500). Baja el
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
