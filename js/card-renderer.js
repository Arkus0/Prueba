// Renderiza la tarjeta de resultado (DOM real, no solo imagen) y la captura a PNG.
// La parte más delicada es el mini-mapa: usa una instancia Leaflet aislada (no la de
// edición) con tiles CORS-friendly, y espera a que terminen de cargar antes de capturar.
'use strict';

window.GP = window.GP || {};

(function () {
  const ROUTE_COLOR = '#fc4c02';
  const DEFAULT_WEIGHT_KG = 70;
  const CHART_MAX_POINTS = 200;

  let cardMap = null;
  let cardTileLayer = null;
  let cardPolyline = null;
  let chartInstance = null;

  function initCardMapIfNeeded() {
    if (cardMap) return cardMap;
    cardMap = L.map('card-map-preview', {
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      attributionControl: true,
    });
    cardTileLayer = L.tileLayer(window.GP.map.TILE_URL, {
      attribution: window.GP.map.TILE_ATTRIBUTION,
      crossOrigin: true,
      maxZoom: 19,
    }).addTo(cardMap);
    return cardMap;
  }

  function renderCardMap(routePoints) {
    const map = initCardMapIfNeeded();
    map.invalidateSize();
    const latlngs = routePoints.map((p) => [p.lat, p.lng]);
    if (cardPolyline) map.removeLayer(cardPolyline);
    cardPolyline = L.polyline(latlngs, { color: ROUTE_COLOR, weight: 5, opacity: 0.95 }).addTo(map);
    map.fitBounds(cardPolyline.getBounds(), { padding: [24, 24] });
    return map;
  }

  function waitForTilesLoaded(timeoutMs = 4000) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      const timer = setTimeout(finish, timeoutMs);
      cardTileLayer.once('load', () => {
        clearTimeout(timer);
        finish();
      });
    });
  }

  function subsample(points, maxPoints = CHART_MAX_POINTS) {
    if (points.length <= maxPoints) return points;
    const step = Math.ceil(points.length / maxPoints);
    return points.filter((_, i) => i % step === 0);
  }

  function populateStatsDOM(activity, options = {}) {
    const utils = window.GP.utils;
    document.getElementById('card-title').textContent = options.name || 'Carrera';
    document.getElementById('card-date').textContent = new Date(activity.startDateTime).toLocaleString('es-ES', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    document.getElementById('stat-distance').textContent = `${activity.totalDistanceKm.toFixed(2)} km`;
    document.getElementById('stat-time').textContent = utils.formatDuration(activity.totalDurationSec);
    document.getElementById('stat-pace').textContent = `${utils.formatPace(activity.avgPaceMinPerKm)} /km`;
    document.getElementById('stat-elevation').textContent = `${activity.elevationGainM} m`;

    const hrWrapper = document.getElementById('stat-hr-wrapper');
    if (activity.includeHeartRate) {
      const hrValues = activity.points.map((p) => p.hr).filter((v) => typeof v === 'number');
      const avgHr = hrValues.length ? Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length) : null;
      document.getElementById('stat-hr').textContent = avgHr ? `${avgHr} bpm` : '—';
      hrWrapper.hidden = false;
    } else {
      hrWrapper.hidden = true;
    }

    const calories = Math.round(activity.totalDistanceKm * (options.weightKg || DEFAULT_WEIGHT_KG) * 1.036);
    document.getElementById('stat-calories').textContent = `${calories}`;
  }

  function renderSplitsTable(splits) {
    const utils = window.GP.utils;
    const tbody = document.getElementById('card-splits-body');
    tbody.innerHTML = splits
      .map((s) => `<tr><td>${s.splitKm}</td><td>${utils.formatPace(s.paceMinPerKm)}/km</td><td>${utils.formatDuration(s.durationSec)}</td></tr>`)
      .join('');
  }

  function renderElevationChart(points, includeHeartRate) {
    const sampled = subsample(points);
    const ctx = document.getElementById('card-elevation-chart').getContext('2d');
    const datasets = [
      {
        label: 'Elevación (m)',
        data: sampled.map((p) => p.ele),
        borderColor: ROUTE_COLOR,
        backgroundColor: 'rgba(252, 76, 2, 0.15)',
        fill: true,
        pointRadius: 0,
        tension: 0.3,
        yAxisID: 'y',
      },
    ];
    if (includeHeartRate) {
      datasets.push({
        label: 'FC (bpm)',
        data: sampled.map((p) => p.hr),
        borderColor: '#2563eb',
        pointRadius: 0,
        tension: 0.3,
        yAxisID: 'y1',
      });
    }

    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
      type: 'line',
      data: { labels: sampled.map((p) => p.cumulativeDistanceKm.toFixed(1)), datasets },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { display: false },
          y: { position: 'left', title: { display: true, text: 'm' } },
          y1: includeHeartRate
            ? { position: 'right', title: { display: true, text: 'bpm' }, grid: { drawOnChartArea: false } }
            : { display: false },
        },
        plugins: { legend: { display: includeHeartRate } },
      },
    });
  }

  function captureCardAsPng() {
    const node = document.getElementById('activity-card');
    return html2canvas(node, { useCORS: true, scale: 2 }).then(
      (canvas) => new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'))
    );
  }

  // Orquestador: puebla la tarjeta (DOM real, queda visible como preview),
  // espera a que cargue el mini-mapa y devuelve el PNG capturado.
  async function generateActivityCard(activity, options = {}) {
    populateStatsDOM(activity, options);
    renderSplitsTable(activity.splits);
    renderElevationChart(activity.points, activity.includeHeartRate);
    renderCardMap(activity.points);
    await waitForTilesLoaded();
    // pequeño margen para el repaint del navegador (resize del chart, fonts, etc.)
    await new Promise((resolve) => setTimeout(resolve, 200));
    return captureCardAsPng();
  }

  window.GP.cardRenderer = { generateActivityCard, captureCardAsPng };
})();
