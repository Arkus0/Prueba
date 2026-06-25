// Funciones geométricas puras compartidas por map.js y activity-generator.js
'use strict';

window.GP = window.GP || {};

(function () {
  const EARTH_RADIUS_KM = 6371;

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  function haversineDistanceKm(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_KM * c;
  }

  // Punto a una fracción [0,1] entre dos coordenadas (interpolación lineal,
  // suficiente a la escala de unos pocos metros que usamos para densificar rutas).
  function interpolatePoint(lat1, lon1, lat2, lon2, fraction) {
    return {
      lat: lat1 + (lat2 - lat1) * fraction,
      lng: lon1 + (lon2 - lon1) * fraction,
    };
  }

  function totalRouteDistanceKm(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += haversineDistanceKm(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    }
    return total;
  }

  window.GP.geoUtils = { haversineDistanceKm, interpolatePoint, totalRouteDistanceKm, toRad };
})();
