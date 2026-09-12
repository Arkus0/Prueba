/**
 * Capa de datos: todo sale de ficheros JSON estáticos que genera la ingesta
 * diaria. Nada de peticiones a terceros desde el móvil: se descarga poco,
 * se cachea y funciona sin cobertura una vez visitada la página.
 */

const RUTA = 'data';

export const estado = {
  indice: null,
  dias: new Map(),      // fecha -> { items, omitidos, importeOmitido }
  glosario: {},
  senales: {},
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

/** Fechas disponibles, de la más reciente a la más antigua. */
export function fechasDisponibles() {
  return (estado.indice?.dias || []).map((d) => d.fecha);
}

/** Carga los N días más recientes y devuelve todos sus items juntos. */
export async function cargarUltimos(nDias) {
  const fechas = fechasDisponibles().slice(0, nDias);
  await Promise.all(fechas.map((f) => cargarDia(f).catch(() => null)));
  return itemsCargados();
}

/** Todos los items ya descargados, de más reciente a más antiguo. */
export function itemsCargados() {
  const todos = [];
  for (const fecha of fechasDisponibles()) {
    const dia = estado.dias.get(fecha);
    if (dia) todos.push(...dia.items);
  }
  return todos;
}

export function diasCargados() {
  return estado.dias.size;
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
