/**
 * Capa de datos: todo sale de ficheros JSON estáticos que genera la ingesta
 * diaria. Nada de peticiones a terceros desde el móvil: se descarga poco,
 * se cachea y funciona sin cobertura una vez visitada la página.
 */

import { REGIONES } from './mapa-espana.js';

const RUTA = 'data';

/** Código de comunidad -> nombre. Sale del mismo sitio que el mapa, para que
 *  no puedan decir cosas distintas. */
const NOMBRES_CCAA = new Map(REGIONES.map((r) => [r.codigo, r.nombre]));

export const nombreDeCCAA = (codigo) => NOMBRES_CCAA.get(codigo) || null;

export const estado = {
  indice: null,
  dias: new Map(),      // fecha -> { items, omitidos, importeOmitido }
  fechasActivas: [],    // ventana que la pantalla ha pedido; el caché puede contener más días
  glosario: {},
  senales: {},
  oposiciones: null,
  error: null,
};

async function traer(ruta) {
  const respuesta = await fetch(`${RUTA}/${ruta}`, { cache: 'no-cache' });
  if (!respuesta.ok) throw new Error(`No se pudo leer ${ruta} (${respuesta.status})`);
  return respuesta.json();
}

/** Carga el índice, el glosario y las señales. Es lo primero que hace la app. */
export async function arrancar() {
  const [indice, glosario, senales] = await Promise.all([
    traer('index.json'),
    traer('glosario.json').catch(() => ({})),
    traer('senales.json').catch(() => ({})),
  ]);
  estado.indice = indice;
  estado.glosario = glosario;
  estado.senales = senales;
  return indice;
}

/** Carga (y memoriza) el fichero de un día concreto. */
export async function cargarDia(fecha) {
  if (estado.dias.has(fecha)) return estado.dias.get(fecha);
  const dia = await traer(`dias/${fecha}.json`);
  estado.dias.set(fecha, dia);
  return dia;
}

/** Convocatorias de empleo público, con su plazo. Se carga una sola vez. */
export async function cargarOposiciones() {
  if (estado.oposiciones) return estado.oposiciones;
  const datos = await traer('oposiciones.json').catch(() => ({ convocatorias: [] }));
  estado.oposiciones = datos.convocatorias || [];
  return estado.oposiciones;
}

/** Fechas disponibles, de la más reciente a la más antigua. */
export function fechasDisponibles() {
  return (estado.indice?.dias || []).map((d) => d.fecha);
}

/**
 * Carga los N días más recientes y los convierte en la ventana ACTIVA.
 * El Map conserva otros días ya descargados para no pedirlos dos veces, pero
 * una pantalla nunca debe mezclar por accidente ese histórico con su ventana:
 * con meses de datos cacheados (mapa, "buscar más atrás"...), Contratos o
 * Personas acababan enseñando de golpe todo lo que hubiera en el Map, no solo
 * los días que esa pantalla pidió.
 */
export async function cargarUltimos(nDias) {
  const fechas = fechasDisponibles().slice(0, nDias);
  await Promise.all(fechas.map((f) => cargarDia(f).catch(() => null)));
  estado.fechasActivas = fechas.filter((f) => estado.dias.has(f));
  return itemsCargados();
}

/** Items de la ventana activa, no de todo lo que alguna pantalla haya cacheado. */
export function itemsCargados() {
  const todos = [];
  for (const fecha of estado.fechasActivas) {
    const dia = estado.dias.get(fecha);
    if (dia) todos.push(...dia.items);
  }
  return todos;
}

/** Días que pertenecen a la ventana que el usuario está viendo ahora. */
export function diasCargados() {
  return estado.fechasActivas.length;
}

/** ¿Alguna fuente oficial falló en la última ingesta? */
export function fuentesConProblema() {
  return (estado.indice?.fuentes || []).filter((f) => f.estado === 'error');
}

export function glosarioDe(clave) {
  return estado.glosario[clave] || null;
}

export function senalDe(clave) {
  return estado.senales[clave] || null;
}
