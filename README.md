# GhostPace

Generador de carreras falsas estilo Strava: dibuja una ruta sobre un mapa real,
elige el ritmo, y obtén una **tarjeta de resumen (PNG)** y un **archivo GPX**
de una carrera que nunca corriste. Inspirado en [fakemy.run](https://fakemy.run),
con marca propia para no usar el nombre ni el logo de Strava.

> No afiliado con Strava, Garmin ni ninguna marca de fitness. Pensado para
> entretenimiento/parodia. El uso del GPX generado es responsabilidad de quien
> lo descarga.

## Cómo funciona

1. Busca un lugar o navega el mapa, y haz clic para ir dibujando los puntos de
   la ruta (mínimo 2, separados al menos 50 m en total).
2. Ajusta el ritmo medio y la "inconsistencia de ritmo" (0% = ritmo perfectamente
   constante, 100% = variación notable entre kilómetros, con un arranque algo
   más lento y un "kick" final).
3. Pon nombre, fecha/hora de inicio y, si quieres, activa frecuencia cardíaca.
4. Genera la carrera: se calculan splits por km, un perfil de elevación real
   (o sintético si la API no responde) y, si lo activaste, una curva de FC.
5. Descarga la tarjeta en PNG y/o el GPX. El GPX es GPX 1.1 estándar con la
   extensión de Garmin para FC por punto, compatible con la importación de
   Strava/Garmin Connect.

## Stack

HTML/CSS/JS estático, sin build ni backend. Las dependencias de terceros
(Leaflet, Chart.js, html2canvas) están **vendorizadas** en `js/vendor/` y
`css/vendor/` (copiadas de sus paquetes npm oficiales) en lugar de cargarse
desde un CDN, para no depender de la disponibilidad de un CDN en tiempo de
ejecución. Desplegable en Vercel (u otro hosting estático) sin pasos previos.

## Ejecutar en local

Hace falta servir los archivos por HTTP (no abrir `index.html` con `file://`,
porque rompe las llamadas a Nominatim/Open-Elevation por CORS):

```bash
python3 -m http.server 8080
# o
npx serve .
```

Y abrir `http://localhost:8080/`.

## APIs externas y límites

- **Búsqueda de ubicación**: [Nominatim](https://nominatim.openstreetmap.org/)
  (OpenStreetMap), gratuita y sin API key. Política de uso justo: máx. ~1
  petición/segundo; la búsqueda en la app aplica *debounce* para respetarlo.
- **Elevación**: [Open-Elevation](https://open-elevation.com/), gratuita y sin
  API key. Si no responde (caída del servicio, sin red), la app genera un
  perfil de elevación sintético (ondulación + ruido, con la pendiente acotada)
  para que la carrera nunca se rompa por esto.
- **Ajustar ruta a carreteras**: servicio de routing [OSRM](http://project-osrm.org/)
  operado por [routing.openstreetmap.de](https://routing.openstreetmap.de/),
  perfil "foot" (caminos/aceras/calles peatonales), gratuito y sin API key. El
  botón "Ajustar ruta a carreteras" sustituye los puntos dibujados a mano por
  el trazado real que devuelve el servicio. Si no responde o no encuentra un
  camino entre los puntos, se muestra un error y la ruta dibujada se mantiene
  intacta (no rompe la app).
- **Teselas del mapa**: [CARTO](https://carto.com/attributions) (`light_all`),
  elegidas por servir con cabeceras CORS, necesarias para poder capturar el
  mini-mapa de la tarjeta con `html2canvas` sin error de "tainted canvas".

Ninguna de estas APIs requiere clave ni configuración: si alguna falla o no
hay red, la app degrada con elegancia (ver más abajo) en lugar de romperse.

## Limitaciones conocidas

- Sin conexión a Nominatim: la búsqueda de ubicación no devuelve resultados,
  pero se puede seguir navegando el mapa manualmente y dibujando la ruta.
- Sin conexión a Open-Elevation: se usa el perfil de elevación sintético.
- Sin conexión al servicio de routing: "Ajustar ruta a carreteras" muestra un
  error y la ruta dibujada a mano se mantiene sin cambios.
- Rutas muy largas se densifican con un punto cada ~10 m, con un tope de 5000
  puntos (se amplía el espaciado automáticamente para no colgar el navegador).

## Atribución

Mapas © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors,
teselas de [CARTO](https://carto.com/attributions). Librerías de terceros:
[Leaflet](https://leafletjs.com/), [Chart.js](https://www.chartjs.org/),
[html2canvas](https://html2canvas.hertzen.com/).
