// Perfil de elevación: API real (Open-Elevation) con fallback sintético si falla/no hay red
'use strict';

window.GP = window.GP || {};

(function () {
  const OPEN_ELEVATION_URL = 'https://api.open-elevation.com/api/v1/lookup';
  const BATCH_SIZE = 100;
  const TIMEOUT_MS = 7000;

  async function fetchElevationBatch(batch, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(OPEN_ELEVATION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locations: batch.map((p) => ({ latitude: p.lat, longitude: p.lng })),
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Open-Elevation respondió ${res.status}`);
      const data = await res.json();
      if (!data.results || data.results.length !== batch.length) {
        throw new Error('Respuesta de Open-Elevation incompleta');
      }
      return data.results.map((r) => r.elevation);
    } finally {
      clearTimeout(timer);
    }
  }

  // points: [{lat, lng, ...}] -> devuelve array de elevaciones (m) en el mismo orden.
  // Lanza si la API falla; quien la llame decide el fallback (ver getElevationProfile).
  async function fetchElevationProfile(points, options = {}) {
    const batchSize = options.batchSize || BATCH_SIZE;
    const timeoutMs = options.timeoutMs || TIMEOUT_MS;
    const elevations = [];
    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize);
      const batchElevations = await fetchElevationBatch(batch, timeoutMs);
      elevations.push(...batchElevations);
    }
    return elevations;
  }

  // Ondulación sintética tipo "rolling hills": suma de dos senos de distinta
  // frecuencia/amplitud sobre la distancia acumulada + ruido pequeño, con la
  // pendiente entre puntos consecutivos limitada para evitar saltos irreales.
  // points: [{cumulativeDistanceKm, ...}] (requiere distancia acumulada en km).
  function generateSyntheticElevation(points, baseElevation = 50) {
    if (points.length === 0) return [];
    const clamp = window.GP.utils.clamp;
    const amp1 = 8 + Math.random() * 12;
    const freq1 = 0.15 + Math.random() * 0.1;
    const phase1 = Math.random() * Math.PI * 2;
    const amp2 = 3 + Math.random() * 5;
    const freq2 = 0.5 + Math.random() * 0.3;
    const phase2 = Math.random() * Math.PI * 2;
    const maxGradePercent = 12;

    const raw = points.map((p) => {
      const d = p.cumulativeDistanceKm;
      const noise = (Math.random() - 0.5) * 1.5;
      return (
        baseElevation +
        amp1 * Math.sin(d * freq1 * 2 * Math.PI + phase1) +
        amp2 * Math.sin(d * freq2 * 2 * Math.PI + phase2) +
        noise
      );
    });

    const result = [raw[0]];
    for (let i = 1; i < raw.length; i++) {
      const distM = (points[i].cumulativeDistanceKm - points[i - 1].cumulativeDistanceKm) * 1000;
      const maxDelta = Math.max(0.5, distM * (maxGradePercent / 100));
      const delta = clamp(raw[i] - result[i - 1], -maxDelta, maxDelta);
      result.push(result[i - 1] + delta);
    }
    return result;
  }

  // Punto único de integración: intenta la API real, cae a sintético si falla
  // (sin red, timeout, respuesta inválida, etc.) sin lanzar nunca al llamador.
  async function getElevationProfile(points) {
    if (points.length === 0) return [];
    try {
      return await fetchElevationProfile(points);
    } catch (err) {
      console.warn('[GhostPace] Open-Elevation no disponible, usando elevación sintética:', err.message);
      return generateSyntheticElevation(points);
    }
  }

  window.GP.elevation = { fetchElevationProfile, generateSyntheticElevation, getElevationProfile };
})();
