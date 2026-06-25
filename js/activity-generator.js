// Orquesta la generación de una actividad de carrera falsa pero "realista":
// densifica la ruta dibujada, genera splits con ritmo variable, asigna
// timestamps, perfil de elevación y (opcional) curva de frecuencia cardíaca.
'use strict';

window.GP = window.GP || {};

(function () {
  const MAX_DENSIFIED_POINTS = 5000;
  const MIN_PACE_MIN_PER_KM = 1.5; // suelo de seguridad, no una restricción "realista"

  function densifyRoute(routePoints, targetSpacingMeters = 10) {
    if (routePoints.length < 2) return [];
    const geo = window.GP.geoUtils;
    const totalKm = geo.totalRouteDistanceKm(routePoints);
    const estimatedPoints = (totalKm * 1000) / targetSpacingMeters;
    const spacingKm =
      estimatedPoints > MAX_DENSIFIED_POINTS
        ? totalKm / MAX_DENSIFIED_POINTS
        : targetSpacingMeters / 1000;

    const result = [{ lat: routePoints[0].lat, lng: routePoints[0].lng, cumulativeDistanceKm: 0 }];
    let cumulative = 0;
    for (let i = 1; i < routePoints.length; i++) {
      const prev = routePoints[i - 1];
      const curr = routePoints[i];
      const segDistKm = geo.haversineDistanceKm(prev.lat, prev.lng, curr.lat, curr.lng);
      if (segDistKm === 0) continue;
      const numSteps = Math.max(1, Math.round(segDistKm / spacingKm));
      for (let step = 1; step <= numSteps; step++) {
        const fraction = step / numSteps;
        const pt = geo.interpolatePoint(prev.lat, prev.lng, curr.lat, curr.lng, fraction);
        cumulative += segDistKm / numSteps;
        result.push({ lat: pt.lat, lng: pt.lng, cumulativeDistanceKm: cumulative });
      }
    }
    return result;
  }

  // Splits por km con ritmo variable: arranque algo más lento, tramo final con "kick".
  // inconsistencyPct (0-100) escala la variación: 0 = ritmo perfectamente constante.
  function generateSplits(totalDistanceKm, paceMinPerKm, inconsistencyPct = 50) {
    const fullKm = Math.floor(totalDistanceKm);
    const remainderKm = totalDistanceKm - fullKm;
    const numSplits = fullKm + (remainderKm > 0.001 ? 1 : 0);
    const variance = window.GP.utils.clamp(inconsistencyPct, 0, 100) / 100;
    const splits = [];
    let cumulativeDistanceKm = 0;
    let cumulativeTimeSec = 0;

    for (let i = 0; i < numSplits; i++) {
      const isLast = i === numSplits - 1;
      const distanceKm = isLast && remainderKm > 0.001 ? remainderKm : 1;
      const progress = i / (numSplits - 1 || 1);

      let variancePct = 0;
      if (variance > 0) {
        variancePct = (Math.random() * 0.05 + 0.03) * variance * (Math.random() < 0.5 ? -1 : 1);
        if (i === 0) variancePct += 0.04 * variance; // calentamiento, algo más lento
        if (progress > 0.85) variancePct -= 0.03 * variance; // kick final
      }

      const splitPace = Math.max(MIN_PACE_MIN_PER_KM, paceMinPerKm * (1 + variancePct));
      const durationSec = splitPace * 60 * distanceKm;

      cumulativeDistanceKm += distanceKm;
      cumulativeTimeSec += durationSec;

      splits.push({
        splitKm: i + 1,
        distanceKm,
        paceMinPerKm: splitPace,
        durationSec,
        cumulativeDistanceKm,
        cumulativeTimeSec,
      });
    }
    return splits;
  }

  // Asigna un timestamp creciente a cada punto densificado interpolando dentro
  // del split al que pertenece (así el ritmo variable por km se refleja en el track).
  function buildTimestampedTrack(densifiedPoints, splits, startDateTime) {
    const startMs = new Date(startDateTime).getTime();
    let splitIdx = 0;

    return densifiedPoints.map((p) => {
      while (splitIdx < splits.length - 1 && p.cumulativeDistanceKm > splits[splitIdx].cumulativeDistanceKm) {
        splitIdx++;
      }
      const split = splits[splitIdx];
      const splitStartDist = splitIdx === 0 ? 0 : splits[splitIdx - 1].cumulativeDistanceKm;
      const splitStartTime = splitIdx === 0 ? 0 : splits[splitIdx - 1].cumulativeTimeSec;
      const fractionIntoSplit = split.distanceKm > 0 ? (p.cumulativeDistanceKm - splitStartDist) / split.distanceKm : 0;
      const timeSec = splitStartTime + fractionIntoSplit * split.durationSec;

      return {
        lat: p.lat,
        lng: p.lng,
        cumulativeDistanceKm: p.cumulativeDistanceKm,
        timeSec,
        time: new Date(startMs + timeSec * 1000).toISOString(),
      };
    });
  }

  // Sube hacia la zona objetivo (ease-in en el primer 5-8% del tiempo), fluctúa
  // alrededor de ella con un random walk acotado, y deriva levemente al alza al final.
  function generateHeartRateCurve(track, hrZoneTarget) {
    if (track.length === 0) return [];
    const clamp = window.GP.utils.clamp;
    const totalTimeSec = track[track.length - 1].timeSec || 1;
    const restHr = 95 + Math.random() * 10;
    const rampFraction = 0.05 + Math.random() * 0.03;
    let prevHr = restHr;

    return track.map((p) => {
      const t = p.timeSec / totalTimeSec;
      let targetHr;
      if (t < rampFraction) {
        const rampProgress = t / rampFraction;
        targetHr = restHr + (hrZoneTarget - restHr) * (rampProgress * rampProgress);
      } else {
        const drift = ((t - rampFraction) / (1 - rampFraction)) * 4;
        targetHr = hrZoneTarget + drift;
      }
      const noise = (Math.random() - 0.5) * 3;
      const hr = clamp(prevHr + (targetHr - prevHr) * 0.15 + noise, 60, 200);
      prevHr = hr;
      return Math.round(hr);
    });
  }

  function computeElevationGainM(track) {
    let gain = 0;
    for (let i = 1; i < track.length; i++) {
      const delta = track[i].ele - track[i - 1].ele;
      if (delta > 0) gain += delta;
    }
    return Math.round(gain);
  }

  // config: { routePoints, paceMinPerKm, startDateTime, includeHeartRate, hrZoneTarget, paceInconsistency }
  async function generateActivity(config) {
    const { routePoints, paceMinPerKm, startDateTime, includeHeartRate, hrZoneTarget, paceInconsistency } = config;
    const geo = window.GP.geoUtils;

    if (!routePoints || routePoints.length < 2) {
      throw new Error('Dibuja al menos 2 puntos en el mapa para crear una ruta.');
    }
    const totalDistanceKm = geo.totalRouteDistanceKm(routePoints);
    if (totalDistanceKm < 0.05) {
      throw new Error('La ruta es demasiado corta (mínimo 50 m).');
    }

    const densified = densifyRoute(routePoints);
    const splits = generateSplits(totalDistanceKm, paceMinPerKm, paceInconsistency);
    let track = buildTimestampedTrack(densified, splits, startDateTime);

    const elevations = await window.GP.elevation.getElevationProfile(track);
    track = track.map((p, i) => ({ ...p, ele: elevations[i] ?? 0 }));

    if (includeHeartRate) {
      const hrValues = generateHeartRateCurve(track, hrZoneTarget || 150);
      track = track.map((p, i) => ({ ...p, hr: hrValues[i] }));
    }

    const totalDurationSec = splits.length ? splits[splits.length - 1].cumulativeTimeSec : 0;
    const avgPaceMinPerKm = totalDistanceKm > 0 ? totalDurationSec / 60 / totalDistanceKm : 0;

    return {
      points: track,
      splits,
      totalDistanceKm,
      totalDurationSec,
      avgPaceMinPerKm,
      elevationGainM: computeElevationGainM(track),
      startDateTime,
      includeHeartRate: !!includeHeartRate,
    };
  }

  window.GP.activityGenerator = {
    densifyRoute,
    generateSplits,
    buildTimestampedTrack,
    generateHeartRateCurve,
    generateActivity,
  };
})();
