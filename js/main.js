// main.js — arranque y cableado: cámara, zona de captura, bucle de OCR, motor de
// preguntas y ajustes. Una vez pulsado "Iniciar cámara", todo es automático.

import { LogicEngine } from './logic.js';
import { llmCall, loadSettings, saveSettings } from './llm.js';
import { createOcrEngine, grabFrame } from './ocr.js';
import * as ui from './ui.js';

const $ = (id) => document.getElementById(id);

const els = {
  video: $('camera'),
  cameraWrap: $('camera-wrap'),
  cropBox: $('crop-box'),
  workCanvas: document.createElement('canvas'),
};

let ocr = null;
let running = false;
let crop = loadCrop();

// ---------------------------------------------------------------------------
// Motor de preguntas
// ---------------------------------------------------------------------------

const engine = new LogicEngine({
  llmCall: (payload, opts) => llmCall(payload, opts),
});

engine.on('tracking', ({ header, options }) => {
  ui.setStatus(options ? `Pregunta en pantalla (${options} opciones)…` : 'Pregunta en pantalla…', 'scan');
});

engine.on('message', ({ text }) => {
  ui.setStatus('Escaneando…', 'scan');
  ui.logEvent(`mensaje (no es pregunta): ${truncate(text, 60)}`);
});

engine.on('queued', ({ revision }) => {
  ui.setStatus(revision ? 'En cola (revisión con opciones)…' : 'En cola…', 'scan');
});

engine.on('asking', ({ revision }) => {
  ui.setStatus(revision ? 'Consultando IA (revisión)…' : 'Consultando IA…', 'asking');
  ui.logEvent('consultando al LLM');
});

engine.on('answer', (answer) => {
  ui.setStatus('Respondida', 'done');
  ui.showAnswer(answer);
  ui.logEvent(`respuesta: ${truncate(answer.parsed.answerLine, 60)}`);
});

engine.on('duplicate', ({ hasCached }) => {
  ui.setStatus(hasCached ? 'Duplicada — respuesta en caché' : 'Duplicada — ignorada', 'dup');
  ui.logEvent('pregunta duplicada ignorada');
});

engine.on('dropped', ({ item }) => {
  ui.logEvent(`cola llena: descartada "${truncate(item.header, 50)}"`);
});

engine.on('error', ({ error }) => {
  ui.setStatus('Error del LLM', 'error');
  ui.logEvent(`error: ${error}`);
});

engine.on('reset', () => {
  ui.clearHistory();
  ui.logEvent('sesión reiniciada');
});

setInterval(() => engine.tick(), 500);

// ---------------------------------------------------------------------------
// Cámara
// ---------------------------------------------------------------------------

$('btn-start').addEventListener('click', startSession);
$('btn-start-settings').addEventListener('click', () => openSettings());

async function startSession() {
  const err = $('start-error');
  err.hidden = true;
  if (!window.isSecureContext) {
    err.textContent = 'La cámara solo funciona en HTTPS o localhost. Sirve la app con servir.bat y ábrela en http://localhost:8000.';
    err.hidden = false;
    return;
  }
  const s = loadSettings();
  const video = s.cameraId
    ? { deviceId: { exact: s.cameraId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    : { width: { ideal: 1920 }, height: { ideal: 1080 } };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    els.video.srcObject = stream;
    await els.video.play();
  } catch (e) {
    err.textContent = `No se pudo acceder a la cámara: ${e.message}`;
    err.hidden = false;
    return;
  }
  $('start-overlay').remove();
  els.cropBox.hidden = false;
  applyCropBox();
  running = true;
  loop();
}

els.video.addEventListener('loadedmetadata', () => {
  const { videoWidth: w, videoHeight: h } = els.video;
  if (w && h) els.cameraWrap.style.aspectRatio = `${w} / ${h}`;
  applyCropBox();
});

// ---------------------------------------------------------------------------
// Bucle de OCR
// ---------------------------------------------------------------------------

async function loop() {
  if (!running) return;
  const started = performance.now();
  if (ocr && els.video.readyState >= 2) {
    try {
      const canvas = grabFrame(els.video, crop, els.workCanvas);
      if (canvas) {
        const data = await ocr.recognize(canvas);
        ui.setRawOcr(data.text || '', data.confidence);
        if (!engine.hasOpenGroup() && (data.text || '').trim().length > 3) {
          ui.setStatus('Escaneando…', 'scan');
        }
        engine.feed(data.text || '');
      }
    } catch (e) {
      ui.logEvent(`OCR: ${e.message}`);
    }
  }
  const period = Number(loadSettings().ocrPeriodMs) || 2000;
  const wait = Math.max(250, period - (performance.now() - started));
  setTimeout(loop, wait);
}

(async function initOcr() {
  try {
    ocr = await createOcrEngine({
      onStatus: (msg) => {
        ui.setStatus(msg, 'idle');
        ui.logEvent(msg);
      },
    });
    ui.setStatus(ocr ? 'Motor OCR listo' : 'Cargando OCR…', 'idle');
  } catch (e) {
    ui.setStatus('Error cargando OCR', 'error');
    ui.logEvent(`OCR init: ${e.message}`);
  }
})();

// ---------------------------------------------------------------------------
// Zona de captura (recuadro arrastrable y redimensionable)
// ---------------------------------------------------------------------------

function loadCrop() {
  try {
    const r = JSON.parse(localStorage.getItem('ocrqa.crop'));
    if (r && typeof r.x === 'number' && r.w > 0 && r.h > 0) return r;
  } catch { /* sin recorte guardado */ }
  return { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
}

function saveCrop() {
  try { localStorage.setItem('ocrqa.crop', JSON.stringify(crop)); } catch { /* sin almacenamiento */ }
}

function applyCropBox() {
  const b = els.cropBox;
  b.style.left = `${crop.x * 100}%`;
  b.style.top = `${crop.y * 100}%`;
  b.style.width = `${crop.w * 100}%`;
  b.style.height = `${crop.h * 100}%`;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

(function setupCropDrag() {
  const box = els.cropBox;
  let mode = null;
  let start = null;

  box.addEventListener('pointerdown', (e) => {
    mode = e.target.dataset.role === 'resize' ? 'resize' : 'move';
    box.setPointerCapture(e.pointerId);
    const r = els.cameraWrap.getBoundingClientRect();
    start = {
      px: (e.clientX - r.left) / r.width,
      py: (e.clientY - r.top) / r.height,
      crop: { ...crop },
    };
    e.preventDefault();
  });

  box.addEventListener('pointermove', (e) => {
    if (!mode) return;
    const r = els.cameraWrap.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    if (mode === 'move') {
      crop.x = clamp(start.crop.x + (px - start.px), 0, 1 - crop.w);
      crop.y = clamp(start.crop.y + (py - start.py), 0, 1 - crop.h);
    } else {
      crop.w = clamp(px - crop.x, 0.08, 1 - crop.x);
      crop.h = clamp(py - crop.y, 0.08, 1 - crop.y);
    }
    applyCropBox();
  });

  const end = () => {
    if (mode) {
      mode = null;
      saveCrop();
    }
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
})();

$('btn-crop-full').addEventListener('click', () => {
  crop = { x: 0, y: 0, w: 1, h: 1 };
  applyCropBox();
  saveCrop();
});

// ---------------------------------------------------------------------------
// Botones y ajustes
// ---------------------------------------------------------------------------

$('btn-new-session').addEventListener('click', () => engine.reset());

$('btn-debug').addEventListener('click', () => {
  const drawer = $('debug-drawer');
  drawer.hidden = !drawer.hidden;
});

const dialog = $('settings-dialog');

async function refreshCameraList(selectedId) {
  const sel = $('set-camera');
  sel.replaceChildren();
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = 'Automática';
  sel.append(auto);
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    devices
      .filter((d) => d.kind === 'videoinput')
      .forEach((d, i) => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `Cámara ${i + 1}`;
        sel.append(opt);
      });
  } catch { /* sin enumeración: queda la opción automática */ }
  sel.value = selectedId || '';
  if (sel.value !== (selectedId || '')) sel.value = '';
}

function openSettings() {
  const s = loadSettings();
  $('set-baseurl').value = s.baseUrl;
  $('set-model').value = s.model;
  $('set-apikey').value = s.apiKey;
  $('set-period').value = s.ocrPeriodMs;
  refreshCameraList(s.cameraId);
  dialog.showModal();
}

$('btn-settings').addEventListener('click', openSettings);
$('btn-settings-cancel').addEventListener('click', () => dialog.close());

$('settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  saveSettings({
    baseUrl: $('set-baseurl').value.trim(),
    model: $('set-model').value.trim(),
    apiKey: $('set-apikey').value.trim(),
    temperature: 0,
    maxTokens: 400,
    ocrPeriodMs: clamp(Number($('set-period').value) || 2000, 800, 10000),
    cameraId: $('set-camera').value || '',
  });
  dialog.close();
  ui.logEvent('ajustes guardados (cambia de cámara reiniciando la app)');
});

// ---------------------------------------------------------------------------
// Hook de prueba (smoke tests y depuración desde la consola del navegador)
// ---------------------------------------------------------------------------

window.__pipeline = {
  engine,
  feed: (text) => engine.feed(text),
  setLlm: (fn) => engine.setLlmCall(fn),
  llm: llmCall,
  settings: { load: loadSettings, save: saveSettings },
};

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
