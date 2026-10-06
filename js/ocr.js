// ocr.js — motor OCR: worker de Tesseract persistente y preprocesado de frames
// (recorte de la zona elegida, escalado y realce de contraste).

// El worker se crea desde un blob: las rutas deben ser absolutas para que
// importScripts las resuelva bien.
function abs(p) {
  return new URL(p, document.baseURI).href;
}

const LOCAL_PATHS = {
  workerPath: abs('vendor/worker.min.js'),
  corePath: abs('vendor/core'),
  langPath: abs('vendor/tessdata'),
};
const CDN_PATHS = {
  workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
  corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
  langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
};

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// Crea el worker intentando primero los ficheros locales (vendor/) y, si fallan,
// la red CDN. Devuelve { recognize, terminate }.
export async function createOcrEngine({ onStatus } = {}) {
  const T = (typeof window !== 'undefined' && window.Tesseract) || null;
  if (!T) throw new Error('Tesseract.js no está cargado');

  let lastErr = null;
  for (const [label, paths] of [['local', LOCAL_PATHS], ['CDN', CDN_PATHS]]) {
    try {
      if (onStatus) onStatus(`Cargando motor OCR (${label})…`);
      const worker = await T.createWorker('spa+eng', 1, {
        ...paths,
        logger: (m) => {
          if (onStatus && m && m.status) onStatus(`OCR: ${m.status}${m.progress != null ? ' ' + Math.round(m.progress * 100) + '%' : ''}`);
        },
      });
      if (onStatus) onStatus('Motor OCR listo');
      return {
        async recognize(canvas) {
          const { data } = await worker.recognize(canvas);
          return data; // { text, confidence, ... }
        },
        async terminate() {
          try { await worker.terminate(); } catch { /* ya terminado */ }
        },
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`No se pudo inicializar el OCR: ${lastErr && lastErr.message}`);
}

// Captura la zona seleccionada del vídeo en un canvas mejorado para OCR.
// rectNorm = { x, y, w, h } en fracciones 0..1 sobre el frame del vídeo.
export function grabFrame(video, rectNorm, canvas) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const x = Math.round(clamp01(rectNorm.x) * vw);
  const y = Math.round(clamp01(rectNorm.y) * vh);
  const w = Math.max(16, Math.round(clamp01(rectNorm.w) * vw));
  const h = Math.max(16, Math.round(clamp01(rectNorm.h) * vh));

  // texto de pantalla: apunta a ~1000 px de alto, como mucho ×3
  const scale = Math.min(3, Math.max(1, 1000 / h));
  canvas.width = Math.max(16, Math.round(w * scale));
  canvas.height = Math.max(16, Math.round(h * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(video, x, y, w, h, 0, 0, canvas.width, canvas.height);
  enhanceContrast(ctx, canvas.width, canvas.height);
  return canvas;
}

// Escala de grises + estiramiento de contraste con recorte del 2% por extremo.
function enhanceContrast(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const lum = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
    hist[lum]++;
  }
  const total = w * h;
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= total * 0.02) { lo = v; break; }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= total * 0.02) { hi = v; break; }
  }
  if (hi - lo < 30) return; // imagen sin contraste utilizable: no forzar
  const range = Math.max(1, hi - lo);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const s = ((v - lo) * 255) / range;
    lut[v] = s;
  }
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  }
  ctx.putImageData(img, 0, 0);
}
