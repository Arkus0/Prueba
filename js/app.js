// Punto de entrada: conecta el mapa, el formulario y los generadores de GPX/tarjeta.
'use strict';

(function () {
  const utils = window.GP.utils;

  let currentRoute = { points: [], distanceKm: 0 };
  let currentActivity = null;
  let currentOptions = null;
  let currentPngBlob = null;

  const els = {
    map: document.getElementById('map'),
    distanceValue: document.getElementById('route-distance-value'),
    btnUndo: document.getElementById('btn-undo'),
    btnClear: document.getElementById('btn-clear'),
    btnSnapRoads: document.getElementById('btn-snap-roads'),
    locationSearch: document.getElementById('location-search'),
    searchResults: document.getElementById('search-results'),
    form: document.getElementById('activity-form'),
    btnGenerate: document.getElementById('btn-generate'),
    inputTitle: document.getElementById('input-title'),
    inputPace: document.getElementById('input-pace'),
    inputPaceDisplay: document.getElementById('input-pace-display'),
    inputInconsistency: document.getElementById('input-inconsistency'),
    inputInconsistencyDisplay: document.getElementById('input-inconsistency-display'),
    btnLocate: document.getElementById('btn-locate'),
    inputDatetime: document.getElementById('input-datetime'),
    inputIncludeHr: document.getElementById('input-include-hr'),
    hrZoneWrapper: document.getElementById('hr-zone-wrapper'),
    inputHrZone: document.getElementById('input-hr-zone'),
    formError: document.getElementById('form-error'),
    resultPanel: document.getElementById('result-panel'),
    btnDownloadPng: document.getElementById('btn-download-png'),
    btnDownloadGpx: document.getElementById('btn-download-gpx'),
    loadingOverlay: document.getElementById('loading-overlay'),
    loadingMessage: document.getElementById('loading-message'),
  };

  function nowAsLocalDatetimeValue() {
    const d = new Date();
    const offsetMs = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
  }

  function showError(message) {
    els.formError.textContent = message;
    els.formError.hidden = !message;
  }

  function showLoading(message) {
    els.loadingMessage.textContent = message;
    els.loadingOverlay.hidden = false;
  }

  function hideLoading() {
    els.loadingOverlay.hidden = true;
  }

  function updateGenerateButtonState() {
    els.btnGenerate.disabled = currentRoute.points.length < 2;
  }

  function onRouteChange({ points, distanceKm }) {
    currentRoute = { points, distanceKm };
    els.distanceValue.textContent = `${distanceKm.toFixed(2)} km`;
    updateGenerateButtonState();
  }

  function initMapSection() {
    window.GP.map.initMap('map', { onRouteChange });
    els.btnUndo.addEventListener('click', () => window.GP.map.undoLastPoint());
    els.btnClear.addEventListener('click', () => window.GP.map.clearRoute());
    els.btnLocate.addEventListener('click', async () => {
      try {
        await window.GP.map.locateUser();
      } catch (err) {
        console.warn('[GhostPace] Ubicación no disponible:', err.message);
      }
    });
    els.btnSnapRoads.addEventListener('click', async () => {
      showError('');
      showLoading('Ajustando la ruta a carreteras y caminos…');
      try {
        await window.GP.map.snapRouteToRoads();
      } catch (err) {
        showError(err.message);
      } finally {
        hideLoading();
      }
    });
  }

  function initSliders() {
    const updatePaceDisplay = () => {
      const paceMinPerKm = Number(els.inputPace.value) / 60;
      els.inputPaceDisplay.textContent = `${utils.formatPace(paceMinPerKm)} /km`;
    };
    const updateInconsistencyDisplay = () => {
      els.inputInconsistencyDisplay.textContent = `${els.inputInconsistency.value}%`;
    };
    els.inputPace.addEventListener('input', updatePaceDisplay);
    els.inputInconsistency.addEventListener('input', updateInconsistencyDisplay);
    updatePaceDisplay();
    updateInconsistencyDisplay();
  }

  function renderSearchResults(results) {
    if (!results.length) {
      els.searchResults.hidden = true;
      els.searchResults.innerHTML = '';
      return;
    }
    els.searchResults.innerHTML = results
      .map(
        (r, i) =>
          `<li data-index="${i}">${r.label.length > 70 ? r.label.slice(0, 70) + '…' : r.label}</li>`
      )
      .join('');
    els.searchResults.hidden = false;
    els.searchResults._results = results;
  }

  function initSearchBox() {
    const runSearch = utils.debounce(async (query) => {
      try {
        const results = await window.GP.map.searchLocation(query);
        renderSearchResults(results);
      } catch (err) {
        console.warn('[GhostPace] Búsqueda de ubicación falló:', err.message);
        renderSearchResults([]);
      }
    }, 450);

    els.locationSearch.addEventListener('input', (e) => runSearch(e.target.value));

    els.searchResults.addEventListener('click', (e) => {
      const li = e.target.closest('li');
      if (!li) return;
      const results = els.searchResults._results || [];
      const result = results[Number(li.dataset.index)];
      if (result) {
        window.GP.map.flyToLocation(result.lat, result.lng, 14);
        els.locationSearch.value = result.label;
      }
      els.searchResults.hidden = true;
    });

    document.addEventListener('click', (e) => {
      if (!els.searchResults.contains(e.target) && e.target !== els.locationSearch) {
        els.searchResults.hidden = true;
      }
    });
  }

  function initHrToggle() {
    els.inputIncludeHr.addEventListener('change', () => {
      els.hrZoneWrapper.hidden = !els.inputIncludeHr.checked;
    });
  }

  async function handleFormSubmit(e) {
    e.preventDefault();
    showError('');

    if (currentRoute.points.length < 2) {
      showError('Dibuja al menos 2 puntos en el mapa para crear una ruta.');
      return;
    }
    const paceMinPerKm = Number(els.inputPace.value) / 60;
    const paceInconsistency = Number(els.inputInconsistency.value);
    if (!els.inputDatetime.value) {
      showError('Elige una fecha y hora de inicio.');
      return;
    }

    const title = els.inputTitle.value.trim() || 'Carrera';
    const startDateTime = new Date(els.inputDatetime.value).toISOString();
    const includeHeartRate = els.inputIncludeHr.checked;
    const hrZoneTarget = Number(els.inputHrZone.value) || 150;

    els.btnGenerate.disabled = true;
    showLoading('Generando datos de la carrera…');

    try {
      const activity = await window.GP.activityGenerator.generateActivity({
        routePoints: currentRoute.points,
        paceMinPerKm,
        startDateTime,
        includeHeartRate,
        hrZoneTarget,
        paceInconsistency,
      });

      currentActivity = activity;
      currentOptions = { name: title };

      els.resultPanel.hidden = false;
      showLoading('Componiendo la tarjeta y el mapa…');
      currentPngBlob = await window.GP.cardRenderer.generateActivityCard(activity, currentOptions);

      els.resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error('[GhostPace] Error generando la actividad:', err);
      showError(err.message || 'Algo salió mal generando la carrera. Inténtalo de nuevo.');
    } finally {
      hideLoading();
      updateGenerateButtonState();
    }
  }

  function dateStampFor(activity) {
    return new Date(activity.startDateTime).toISOString().slice(0, 10);
  }

  function initResultActions() {
    els.btnDownloadPng.addEventListener('click', async () => {
      if (!currentActivity) return;
      let blob = currentPngBlob;
      if (!blob) {
        blob = await window.GP.cardRenderer.captureCardAsPng();
      }
      const filename = `${utils.sanitizeFilename(currentOptions.name)}-${dateStampFor(currentActivity)}.png`;
      utils.downloadBlob(blob, filename);
    });

    els.btnDownloadGpx.addEventListener('click', () => {
      if (!currentActivity) return;
      window.GP.gpxExport.downloadGpx(currentActivity, currentOptions);
    });
  }

  function init() {
    els.inputDatetime.value = nowAsLocalDatetimeValue();
    initMapSection();
    initSearchBox();
    initSliders();
    initHrToggle();
    initResultActions();
    els.form.addEventListener('submit', handleFormSubmit);
    updateGenerateButtonState();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
