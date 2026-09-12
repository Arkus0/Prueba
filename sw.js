/**
 * Service worker: el armazón se guarda en el móvil y los datos se refrescan
 * cuando hay red. Así la app abre al instante y sigue leyéndose en el metro.
 */

const VERSION = 'dinero-publico-v1';
const ARMAZON = [
  './',
  './index.html',
  './css/base.css',
  './css/app.css',
  './js/app.js',
  './js/datos.js',
  './js/formato.js',
  './js/ui.js',
  './js/vistas.js',
  './manifest.webmanifest',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ARMAZON)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((c) => c !== VERSION).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET' || new URL(peticion.url).origin !== location.origin) return;

  // Datos: primero la red (para tener lo último), con la copia guardada de reserva.
  if (peticion.url.includes('/data/')) {
    evento.respondWith(
      fetch(peticion)
        .then((respuesta) => {
          const copia = respuesta.clone();
          caches.open(VERSION).then((cache) => cache.put(peticion, copia));
          return respuesta;
        })
        .catch(() => caches.match(peticion)),
    );
    return;
  }

  // Armazón: primero la copia guardada, y de fondo se actualiza.
  evento.respondWith(
    caches.match(peticion).then((guardada) => guardada || fetch(peticion).then((respuesta) => {
      const copia = respuesta.clone();
      caches.open(VERSION).then((cache) => cache.put(peticion, copia));
      return respuesta;
    })),
  );
});
