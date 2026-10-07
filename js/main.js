// main.js — arranque y cableado: cámara, zona de captura, bucle de OCR, motor de
// preguntas y ajustes. Una vez pulsado "Iniciar cámara", todo es automático.

import { LogicEngine } from './logic.js';
import { llmCall, loadSettings, saveSettings } from './llm.js';
import { createOcrEngine, grabFrame } from './ocr.js';
import { OcrGate } from './capture-gate.js';
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
  ui.clearBoard();
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
// Bucle de captura: comprobación barata de cambios en la ROI (~700 ms) y OCR solo
// cuando la imagen ha cambiado y ha pasado el periodo configurado.
// ---------------------------------------------------------------------------

const DIFF_W = 64;
const DIFF_H = 36;
const diffCanvas = document.createElement('canvas');
let prevLum = null;
const ocrGate = new OcrGate();

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function roiChanged() {
  const vw = els.video.videoWidth;
  const vh = els.video.videoHeight;
  if (!vw || !vh) return true;
  diffCanvas.width = DIFF_W;
  diffCanvas.height = DIFF_H;
  const ctx = diffCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(
    els.video,
    Math.round(clamp01(crop.x) * vw), Math.round(clamp01(crop.y) * vh),
    Math.max(16, Math.round(clamp01(crop.w) * vw)), Math.max(16, Math.round(clamp01(crop.h) * vh)),
    0, 0, DIFF_W, DIFF_H,
  );
  const d = ctx.getImageData(0, 0, DIFF_W, DIFF_H).data;
  const lum = new Uint8Array(DIFF_W * DIFF_H);
  for (let i = 0; i < lum.length; i++) {
    const j = i * 4;
    lum[i] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000 | 0;
  }
  if (!prevLum) {
    prevLum = lum;
    return true;
  }
  let changed = 0;
  for (let i = 0; i < lum.length; i++) {
    if (Math.abs(lum[i] - prevLum[i]) > 25) changed++;
  }
  prevLum = lum;
  return changed / lum.length > 0.004;
}

async function loop() {
  if (!running) return;
  const t0 = performance.now();
  const period = Number(loadSettings().ocrPeriodMs) || 1500;
  const ready = !!(ocr && els.video.readyState >= 2);
  const changed = ready ? roiChanged() : false;
  const shouldOcr = ready && ocrGate.shouldRun({
    changed,
    now: t0,
    periodMs: period,
    hasOpenGroup: engine.hasOpenGroup(),
  });

  let didOcr = false;
  if (shouldOcr) {
    didOcr = true;
    ocrGate.markRun(t0);
    try {
      const canvas = grabFrame(els.video, crop, els.workCanvas);
      if (canvas) {
        const data = await ocr.recognize(canvas);
        ui.setRawOcr(data.text || '', data.confidence);
        if (!engine.hasOpenGroup() && (data.text || '').trim().length > 3) {
          ui.setStatus('Escaneando…', 'scan');
        }
        engine.feed(data.text || '', Date.now(), data.confidence);
      }
    } catch (e) {
      ui.logEvent(`OCR: ${e.message}`);
    }
  }

  // En reposo solo hacemos la comparación visual barata. Cuando hay una pregunta
  // abierta o estamos confirmando un cambio, volvemos pronto para conseguir las
  // lecturas estables que exige LogicEngine.
  setTimeout(loop, didOcr ? 350 : 700);
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
// Modo presentación: solo la respuesta, a pantalla completa
// ---------------------------------------------------------------------------

$('btn-present').addEventListener('click', () => setPresentMode(true));
$('btn-exit-present').addEventListener('click', () => setPresentMode(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setPresentMode(false);
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && document.body.classList.contains('present')) {
    document.body.classList.remove('present');
    $('btn-exit-present').hidden = true;
  }
});

function setPresentMode(on) {
  document.body.classList.toggle('present', on);
  $('btn-exit-present').hidden = !on;
  if (on && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => { /* sin permiso: seguir en modo presentación */ });
  }
  if (!on && document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => { /* ya salimos */ });
  }
}

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
  $('set-reasoning').value = s.reasoningEffort || 'high';
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
    reasoningEffort: $('set-reasoning').value || 'high',
    temperature: 0,
    maxTokens: 1200,
    ocrPeriodMs: clamp(Number($('set-period').value) || 1500, 800, 10000),
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
