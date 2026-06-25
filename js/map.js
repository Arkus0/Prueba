// Mapa interactivo: dibujo de ruta a clicks + búsqueda de ubicación (Nominatim)
'use strict';

window.GP = window.GP || {};

(function () {
  // CARTO sirve los tiles con cabeceras CORS, necesario para poder capturar
  // el mini-mapa de la tarjeta con html2canvas más adelante sin "tainted canvas".
  const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  const TILE_ATTRIBUTION =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
  const DEFAULT_CENTER = { lat: 40.4168, lng: -3.7038 }; // Madrid, fallback si no hay geolocalización
  const ROUTE_COLOR = '#fc4c02';
  // Servicio gratuito de routing (OSRM) operado por OpenStreetMap.de, perfil "foot"
  // (caminos/aceras/calles peatonales, más realista para una carrera que "driving").
  const ROUTING_URL = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/';

  let map = null;
  let routePoints = [];
  let polyline = null;
  let markers = [];
  let onRouteChange = null;

  function tileLayerOptions() {
    return { attribution: TILE_ATTRIBUTION, crossOrigin: true, maxZoom: 19 };
  }

  function notifyRouteChange() {
    if (typeof onRouteChange === 'function') {
      onRouteChange({
        points: getRoutePoints(),
        distanceKm: calculateTotalDistanceKm(),
      });
    }
  }

  function redrawPolyline() {
    const latlngs = routePoints.map((p) => [p.lat, p.lng]);
    if (polyline) {
      polyline.setLatLngs(latlngs);
    } else if (latlngs.length > 0) {
      polyline = L.polyline(latlngs, { color: ROUTE_COLOR, weight: 4, opacity: 0.9 }).addTo(map);
    }
  }

  function addPoint(lat, lng) {
    routePoints.push({ lat, lng });
    const marker = L.circleMarker([lat, lng], {
      radius: 5,
      color: ROUTE_COLOR,
      weight: 2,
      fillColor: '#fff',
      fillOpacity: 1,
    }).addTo(map);
    markers.push(marker);
    redrawPolyline();
    notifyRouteChange();
  }

  function handleMapClick(e) {
    addPoint(e.latlng.lat, e.latlng.lng);
  }

  function initMap(containerId, options = {}) {
    onRouteChange = options.onRouteChange || null;
    // zoomControl en topright para no chocar con el buscador flotante (topleft).
    map = L.map(containerId, { zoomControl: false }).setView(
      [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng],
      13
    );
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.tileLayer(TILE_URL, tileLayerOptions()).addTo(map);
    map.on('click', handleMapClick);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => flyToLocation(pos.coords.latitude, pos.coords.longitude, 14),
        () => {
          /* permiso denegado o no disponible: nos quedamos en el centro por defecto */
        },
        { timeout: 5000 }
      );
    }
    return map;
  }

  function undoLastPoint() {
    routePoints.pop();
    const marker = markers.pop();
    if (marker) map.removeLayer(marker);
    redrawPolyline();
    notifyRouteChange();
  }

  function clearRoute() {
    routePoints = [];
    markers.forEach((m) => map.removeLayer(m));
    markers = [];
    if (polyline) {
      map.removeLayer(polyline);
      polyline = null;
    }
    notifyRouteChange();
  }

  function getRoutePoints() {
    return routePoints.map((p) => ({ ...p }));
  }

  function calculateTotalDistanceKm() {
    return window.GP.geoUtils.totalRouteDistanceKm(routePoints);
  }

  function flyToLocation(lat, lng, zoom = 14) {
    if (map) map.flyTo([lat, lng], zoom);
  }

  // Sustituye los puntos dibujados a mano por el trazado real devuelto por el
  // servicio de routing (caminos/calles), conservando el inicio y el final.
  async function snapRouteToRoads() {
    if (routePoints.length < 2) {
      throw new Error('Dibuja al menos 2 puntos en el mapa antes de ajustar la ruta.');
    }
    const coords = routePoints.map((p) => `${p.lng},${p.lat}`).join(';');
    const url = `${ROUTING_URL}${coords}?overview=full&geometries=geojson`;
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      throw new Error('No se pudo contactar con el servicio de rutas. Comprueba tu conexión e inténtalo de nuevo.');
    }
    if (!res.ok) throw new Error(`El servicio de rutas respondió ${res.status}`);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes || !data.routes[0]) {
      throw new Error('No se encontró un camino real entre esos puntos. Prueba a separarlos menos o a dibujar más cerca de calles/senderos.');
    }

    routePoints = data.routes[0].geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
    markers.forEach((m) => map.removeLayer(m));
    markers = [];
    redrawPolyline();
    notifyRouteChange();
  }

  function locateUser() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocalización no disponible en este navegador.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          flyToLocation(pos.coords.latitude, pos.coords.longitude, 14);
          resolve();
        },
        () => reject(new Error('No se pudo obtener tu ubicación.')),
        { timeout: 5000 }
      );
    });
  }

  // Geocoding gratuito vía Nominatim (OSM). Política de uso justo: máx ~1 req/seg,
  // por eso la UI debe aplicar debounce antes de llamar a esta función.
  async function searchLocation(query) {
    const trimmed = (query || '').trim();
    if (trimmed.length < 2) return [];
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(trimmed)}&format=json&limit=5`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Nominatim respondió ${res.status}`);
    const results = await res.json();
    return results.map((r) => ({
      label: r.display_name,
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
    }));
  }

  window.GP.map = {
    initMap,
    undoLastPoint,
    clearRoute,
    getRoutePoints,
    calculateTotalDistanceKm,
    searchLocation,
    flyToLocation,
    locateUser,
    snapRouteToRoads,
    TILE_URL,
    TILE_ATTRIBUTION,
  };
})();
