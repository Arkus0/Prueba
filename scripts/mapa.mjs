/**
 * Generador del mapa y de las tablas de territorio. NO corre en la ingesta
 * diaria: se ejecuta a mano y lo que escribe se sube al repositorio.
 *
 *   node scripts/mapa.mjs
 *
 * Escribe:
 *   js/mapa-espana.js            formas SVG de las comunidades (lo carga el móvil)
 *   scripts/lib/territorio-datos.mjs  provincias, comunidades y municipios del INE
 *
 * Fuente: es-atlas 0.6.0 (MIT, © Martín González), TopoJSON construido sobre la
 * cartografía del Instituto Geográfico Nacional con los identificadores del INE.
 * Se descarga del registro de npm porque los CDN habituales están capados en el
 * entorno de desarrollo; el fichero no se guarda en el repositorio, solo su
 * resultado.
 */

import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ejecutar = promisify(execFile);
const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PAQUETE = 'https://registry.npmjs.org/es-atlas/-/es-atlas-0.6.0.tgz';

/* --------------------------- TopoJSON a mano ----------------------------- */

/**
 * Decodifica un TopoJSON cuantizado. Son deltas enteros sobre una rejilla; se
 * acumulan y se llevan a grados con la transformación del propio fichero.
 * Un índice negativo significa "ese arco, del revés" (~i).
 */
function decodificar(topo) {
  const { scale: [sx, sy], translate: [tx, ty] } = topo.transform;
  const arcos = topo.arcs.map((arco) => {
    let x = 0;
    let y = 0;
    return arco.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * sx + tx, y * sy + ty];
    });
  });
  return (indice) => (indice < 0 ? [...arcos[~indice]].reverse() : arcos[indice]);
}

/** Cose los arcos de un anillo en una sola lista de puntos. */
function anillo(indices, arcoDe) {
  const puntos = [];
  for (const i of indices) {
    const arco = arcoDe(i);
    puntos.push(...(puntos.length ? arco.slice(1) : arco));
  }
  return puntos;
}

const poligonosDe = (geometria) => (geometria.type === 'Polygon' ? [geometria.arcs] : geometria.arcs || []);

/** Área del anillo por la fórmula del cordón. En grados cuadrados. */
function area(puntos) {
  let suma = 0;
  for (let i = 0, j = puntos.length - 1; i < puntos.length; j = i++) {
    suma += puntos[j][0] * puntos[i][1] - puntos[i][0] * puntos[j][1];
  }
  return Math.abs(suma / 2);
}

/** Douglas-Peucker: quita los puntos que no cambian la silueta. */
function simplificar(puntos, tolerancia) {
  if (puntos.length < 3) return puntos;
  const distancia2 = (p, a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (!dx && !dy) return (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    return (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
  };
  const limite = tolerancia * tolerancia;
  const guardar = new Uint8Array(puntos.length);
  guardar[0] = 1;
  guardar[puntos.length - 1] = 1;
  const pila = [[0, puntos.length - 1]];
  while (pila.length) {
    const [inicio, fin] = pila.pop();
    let peor = 0;
    let corte = -1;
    for (let i = inicio + 1; i < fin; i += 1) {
      const d = distancia2(puntos[i], puntos[inicio], puntos[fin]);
      if (d > peor) { peor = d; corte = i; }
    }
    if (corte >= 0 && peor > limite) {
      guardar[corte] = 1;
      pila.push([inicio, corte], [corte, fin]);
    }
  }
  return puntos.filter((_, i) => guardar[i]);
}

/* ------------------------------ Proyección -------------------------------- */

/**
 * Equirrectangular corregida por el coseno de la latitud media peninsular.
 * A la escala de España la distorsión es inapreciable y el resultado se lee
 * como el mapa que todo el mundo tiene en la cabeza.
 */
const LATITUD_MEDIA = (40 * Math.PI) / 180;
const K = Math.cos(LATITUD_MEDIA);
const ESCALA = 74;

const proyectar = ([lon, lat], desvio = [0, 0]) => [
  lon * K * ESCALA + desvio[0],
  -lat * ESCALA + desvio[1],
];

/** Cuánto se simplifica. 0,03° deja 19 KB y la silueta sigue siendo la de España. */
const TOLERANCIA = 0.03;
/** Islotes por debajo de esto no se dibujan: a esta escala son medio píxel. */
const AREA_MINIMA = 0.004;

const CANARIAS = '05';
const CEUTA = '18';
const MELILLA = '19';
const GIBRALTAR = '20';

/** es-atlas trae el nombre largo y oficial; en un móvil no cabe. */
const NOMBRES = {
  '01': 'Andalucía', '02': 'Aragón', '03': 'Asturias', '04': 'Illes Balears',
  '05': 'Canarias', '06': 'Cantabria', '07': 'Castilla y León', '08': 'Castilla-La Mancha',
  '09': 'Cataluña', '10': 'C. Valenciana', '11': 'Extremadura', '12': 'Galicia',
  '13': 'Madrid', '14': 'Murcia', '15': 'Navarra', '16': 'País Vasco',
  '17': 'La Rioja', '18': 'Ceuta', '19': 'Melilla',
};

/**
 * Población por comunidad. INE, Cifras de Población a 1 de enero de 2025,
 * redondeada al millar. Solo se usa para el "por habitante" del mapa, que se
 * enseña siempre etiquetado como aproximado.
 * https://www.ine.es/dynt3/inebase/index.htm?padre=10262
 */
const POBLACION = {
  '01': 8631000, '02': 1351000, '03': 1006000, '04': 1231000,
  '05': 2238000, '06': 590000, '07': 2394000, '08': 2103000,
  '09': 8012000, '10': 5320000, '11': 1064000, '12': 2705000,
  '13': 7010000, '14': 1568000, '15': 678000, '16': 2226000,
  '17': 325000, '18': 83000, '19': 85000,
};

/** Provincia (código INE) a la que pertenece cada comunidad. Tabla oficial del INE. */
const PROVINCIA_A_CCAA = {
  '04': '01', '11': '01', '14': '01', '18': '01', '21': '01', '23': '01', '29': '01', '41': '01',
  '22': '02', '44': '02', '50': '02',
  '33': '03',
  '07': '04',
  '35': '05', '38': '05',
  '39': '06',
  '05': '07', '09': '07', '24': '07', '34': '07', '37': '07', '40': '07', '42': '07', '47': '07', '49': '07',
  '02': '08', '13': '08', '16': '08', '19': '08', '45': '08',
  '08': '09', '17': '09', '25': '09', '43': '09',
  '03': '10', '12': '10', '46': '10',
  '06': '11', '10': '11',
  '15': '12', '27': '12', '32': '12', '36': '12',
  '28': '13',
  '30': '14',
  '31': '15',
  '01': '16', '20': '16', '48': '16',
  '26': '17',
  '51': '18',
  '52': '19',
};

/* -------------------------------- Descarga -------------------------------- */

async function bajarAtlas() {
  const carpeta = await mkdtemp(path.join(tmpdir(), 'es-atlas-'));
  const tgz = path.join(carpeta, 'es-atlas.tgz');
  const respuesta = await fetch(PAQUETE);
  if (!respuesta.ok) throw new Error(`No se pudo bajar es-atlas (${respuesta.status})`);
  await pipeline(Readable.fromWeb(respuesta.body), createWriteStream(tgz));
  await ejecutar('tar', ['xzf', tgz, '-C', carpeta]);
  return carpeta;
}

/* --------------------------------- Mapa ----------------------------------- */

function formasDeComunidades(topo) {
  const arcoDe = decodificar(topo);
  const regiones = [];

  for (const geometria of topo.objects.autonomous_regions.geometries) {
    if (geometria.id === GIBRALTAR) continue;    // no es una comunidad autónoma
    // Ceuta y Melilla son más pequeñas que el filtro de islotes: si se les
    // aplica desaparecen del mapa, y desaparecer no es una opción.
    const minima = (geometria.id === CEUTA || geometria.id === MELILLA) ? 0 : AREA_MINIMA;
    const trozos = [];
    for (const poligono of poligonosDe(geometria)) {
      for (const [indice, arcos] of poligono.entries()) {
        let puntos = anillo(arcos, arcoDe);
        if (indice === 0 && area(puntos) < minima) continue;
        puntos = simplificar(puntos, TOLERANCIA);
        if (puntos.length < 3) continue;
        trozos.push(puntos);
      }
    }
    regiones.push({ codigo: geometria.id, nombre: NOMBRES[geometria.id] || geometria.properties.name, trozos });
  }
  return regiones;
}

const caja = (puntos) => puntos.reduce(
  (c, [x, y]) => [Math.min(c[0], x), Math.min(c[1], y), Math.max(c[2], x), Math.max(c[3], y)],
  [Infinity, Infinity, -Infinity, -Infinity],
);

function comoPaths(regiones) {
  // Primero se proyecta todo sin desvío para saber dónde cae cada cosa.
  const proyectadas = regiones.map((r) => ({
    ...r,
    trozos: r.trozos.map((puntos) => puntos.map((p) => proyectar(p))),
  }));

  // Ceuta y Melilla quedan fuera de esta caja a propósito: son los puntos más
  // bajos del mapa y, si cuentan, empujan el recuadro de Canarias medio mapa
  // hacia abajo y dejan un hueco enorme.
  const peninsula = caja(proyectadas
    .filter((r) => r.codigo !== CANARIAS && r.codigo !== CEUTA && r.codigo !== MELILLA)
    .flatMap((r) => r.trozos.flat()));
  const canarias = proyectadas.find((r) => r.codigo === CANARIAS);

  // Canarias, en su recuadro debajo y a la izquierda de la península, como en
  // cualquier mapa de España. Se coloca a partir de las cajas, no a ojo.
  let recuadro = null;
  if (canarias) {
    const suya = caja(canarias.trozos.flat());
    const margen = 10;
    // Debajo del todo, no metido en el hueco de Portugal: ahí abajo Andalucía
    // baja lo suyo y el recuadro se le montaba encima.
    const dx = peninsula[0] - suya[0];
    const dy = peninsula[3] + margen - suya[1];
    canarias.trozos = canarias.trozos.map((puntos) => puntos.map(([x, y]) => [x + dx, y + dy]));
    const movida = caja(canarias.trozos.flat());
    recuadro = {
      x: +(movida[0] - 5).toFixed(1),
      y: +(movida[1] - 5).toFixed(1),
      ancho: +(movida[2] - movida[0] + 10).toFixed(1),
      alto: +(movida[3] - movida[1] + 10).toFixed(1),
    };
  }

  const salida = [];
  for (const region of proyectadas) {
    // Ceuta y Melilla no llegan a un píxel: van como marcador, tocable igual.
    if (region.codigo === CEUTA || region.codigo === MELILLA) {
      const c = caja(region.trozos.flat());
      salida.push({
        codigo: region.codigo,
        nombre: region.nombre,
        marcador: [+((c[0] + c[2]) / 2).toFixed(1), +((c[1] + c[3]) / 2).toFixed(1)],
      });
      continue;
    }
    const d = region.trozos
      .map((puntos) => `M${puntos.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`)
      .join('');
    if (d) salida.push({ codigo: region.codigo, nombre: region.nombre, d });
  }

  const todo = caja([
    ...proyectadas.flatMap((r) => r.trozos.flat()),
    ...(recuadro ? [[recuadro.x, recuadro.y], [recuadro.x + recuadro.ancho, recuadro.y + recuadro.alto]] : []),
  ]);
  const margen = 4;
  const vista = [todo[0] - margen, todo[1] - margen, todo[2] - todo[0] + margen * 2, todo[3] - todo[1] + margen * 2]
    .map((n) => n.toFixed(1))
    .join(' ');

  return { regiones: salida, vista, recuadro };
}

/* ------------------------------- Municipios ------------------------------- */

/**
 * Índice "nombre de municipio -> provincia". Los repetidos en dos provincias se
 * marcan como ambiguos y se descartan: preferimos no localizar a localizar mal.
 */
function indiceDeMunicipios(topo) {
  const indice = new Map();
  for (const municipio of topo.objects.municipalities.geometries) {
    const provincia = municipio.id.slice(0, 2);
    for (const variante of String(municipio.properties.name).split('/')) {
      for (const forma of variantesDeNombre(variante)) {
        if (forma.length < 5) continue;
        if (indice.has(forma) && indice.get(forma) !== provincia) { indice.set(forma, null); continue; }
        if (!indice.has(forma)) indice.set(forma, provincia);
      }
    }
  }
  return [...indice.entries()].filter(([, provincia]) => provincia !== null);
}

const normalizar = (texto) => String(texto || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9ñ ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * El INE escribe "Rozas de Madrid, Las"; el organismo lo escribirá "Las Rozas
 * de Madrid". Se guardan las dos formas. No se recorta más allá (de "Rozas de
 * Madrid" a "Rozas"): eso choca con Rozas de Valdearroyo y con media España, y
 * un municipio mal asignado es peor que uno sin asignar.
 */
function variantesDeNombre(nombre) {
  const formas = new Set([normalizar(nombre)]);
  const coma = nombre.match(/^(.+),\s*(El|La|Los|Las|L'|Els|Es|Sa|A|O|As|Os)$/i);
  if (coma) {
    formas.add(normalizar(`${coma[2]} ${coma[1]}`));
    formas.add(normalizar(coma[1]));
  }
  return [...formas].filter(Boolean);
}

/* --------------------------------- Main ----------------------------------- */

const carpeta = await bajarAtlas();
try {
  const comunidades = JSON.parse(await readFile(path.join(carpeta, 'package/es/autonomous_regions.json'), 'utf8'));
  const municipios = JSON.parse(await readFile(path.join(carpeta, 'package/es/municipalities.json'), 'utf8'));

  const mapa = comoPaths(formasDeComunidades(comunidades));
  const cabecera = `/**\n * GENERADO POR scripts/mapa.mjs — no se edita a mano.\n *\n * Formas de las comunidades autónomas, simplificadas a ${TOLERANCIA}°.\n * Cartografía del Instituto Geográfico Nacional vía es-atlas (MIT), con los\n * códigos del INE. Canarias va en su recuadro; Ceuta y Melilla, como marcador.\n */\n\n`;
  await writeFile(
    path.join(RAIZ, 'js/mapa-espana.js'),
    `${cabecera}export const VISTA = '${mapa.vista}';\n\nexport const RECUADRO = ${JSON.stringify(mapa.recuadro)};\n\nexport const REGIONES = ${JSON.stringify(mapa.regiones, null, 0).replace(/\},\{/g, '},\n  {').replace(/^\[/, '[\n  ').replace(/\]$/, ',\n]')};\n`,
  );

  const provincias = {};
  for (const provincia of municipios.objects.provinces.geometries) {
    if (!PROVINCIA_A_CCAA[provincia.id]) continue;       // el "territorio no asociado"
    provincias[provincia.id] = { nombre: provincia.properties.name, ccaa: PROVINCIA_A_CCAA[provincia.id] };
  }
  const indice = indiceDeMunicipios(municipios);

  await writeFile(
    path.join(RAIZ, 'scripts/lib/territorio-datos.mjs'),
    `/**\n * GENERADO POR scripts/mapa.mjs — no se edita a mano.\n *\n * Provincias, comunidades y municipios del INE (vía es-atlas, cartografía del\n * IGN). La población es del INE, Cifras de Población a 1 de enero de 2025,\n * redondeada al millar.\n *\n * Solo lo usa la ingesta: no se descarga en el móvil.\n */\n\n`
    + `export const COMUNIDADES = ${JSON.stringify(
      Object.fromEntries(Object.keys(NOMBRES).map((c) => [c, { nombre: NOMBRES[c], poblacion: POBLACION[c] }])),
      null, 1,
    )};\n\n`
    + `export const PROVINCIAS = ${JSON.stringify(provincias, null, 1)};\n\n`
    + `/** nombre normalizado -> código de provincia. Los ambiguos ya están fuera. */\n`
    + `export const MUNICIPIOS = new Map(${JSON.stringify(indice)});\n`,
  );

  const bytes = mapa.regiones.reduce((t, r) => t + (r.d || '').length, 0);
  console.log(`js/mapa-espana.js: ${mapa.regiones.length} regiones, ${(bytes / 1024).toFixed(1)} KB de trazos`);
  console.log(`  viewBox ${mapa.vista}`);
  console.log(`  marcadores: ${mapa.regiones.filter((r) => r.marcador).map((r) => r.nombre).join(', ')}`);
  console.log(`scripts/lib/territorio-datos.mjs: ${Object.keys(provincias).length} provincias, ${indice.length} nombres de municipio`);
} finally {
  await rm(carpeta, { recursive: true, force: true });
}
