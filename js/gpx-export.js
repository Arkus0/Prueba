// Serializa una actividad generada a GPX 1.1 (+ extensión Garmin para FC) y la descarga
'use strict';

window.GP = window.GP || {};

(function () {
  const XML_ESCAPES = { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' };

  function escapeXml(value) {
    return String(value).replace(/[<>&'"]/g, (c) => XML_ESCAPES[c]);
  }

  function buildTrkptXml(point, includeHeartRate) {
    const ext =
      includeHeartRate && typeof point.hr === 'number'
        ? `\n        <extensions>\n          <gpxtpx:TrackPointExtension>\n            <gpxtpx:hr>${point.hr}</gpxtpx:hr>\n          </gpxtpx:TrackPointExtension>\n        </extensions>`
        : '';
    return `      <trkpt lat="${point.lat.toFixed(6)}" lon="${point.lng.toFixed(6)}">\n        <ele>${point.ele.toFixed(1)}</ele>\n        <time>${point.time}</time>${ext}\n      </trkpt>`;
  }

  function buildGpxXml(activity, options = {}) {
    const name = options.name || 'Carrera';
    const activityType = options.activityType || 'running';
    const metadataTime = (activity.points[0] && activity.points[0].time) || new Date().toISOString();
    const trkpts = activity.points.map((p) => buildTrkptXml(p, activity.includeHeartRate)).join('\n');

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<gpx version="1.1" creator="GhostPace"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <time>${metadataTime}</time>
  </metadata>
  <trk>
    <name>${escapeXml(name)}</name>
    <type>${escapeXml(activityType)}</type>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
  }

  function downloadGpx(activity, options = {}) {
    const xml = buildGpxXml(activity, options);
    const blob = new Blob([xml], { type: 'application/gpx+xml' });
    const dateStr = new Date(activity.startDateTime || Date.now()).toISOString().slice(0, 10);
    const filename = `${window.GP.utils.sanitizeFilename(options.name || 'ghostpace-run')}-${dateStr}.gpx`;
    window.GP.utils.downloadBlob(blob, filename);
  }

  window.GP.gpxExport = { buildGpxXml, downloadGpx };
})();
