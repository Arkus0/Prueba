/**
 * Cifras y fechas en cristiano.
 * Un número solo se entiende si puedes compararlo con algo tuyo, así que
 * junto a los importes grandes damos también el "cuánto me toca a mí".
 */

/** Población de España, redondeada. Solo se usa para dar una escala aproximada. */
export const HABITANTES = 49_000_000;

const ES = 'es-ES';
const entero = new Intl.NumberFormat(ES, { maximumFractionDigits: 0 });
const unDecimal = new Intl.NumberFormat(ES, { maximumFractionDigits: 1 });
const dosDecimales = new Intl.NumberFormat(ES, { maximumFractionDigits: 2 });

/** Importe corto y legible: 4,3 M€, 845.000 €, 12,4 mil M€. */
export function euros(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return null;
  const v = Number(n);
  const signo = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (a >= 1e9) return `${signo}${unDecimal.format(a / 1e9)} mil M€`;
  if (a >= 1e6) return `${signo}${unDecimal.format(a / 1e6)} M€`;
  if (a >= 1000) return `${signo}${entero.format(a)} €`;
  return `${signo}${dosDecimales.format(a)} €`;
}

/** La cifra completa, para la ficha y para el atributo title. */
export function eurosExacto(n) {
  if (n === null || n === undefined) return null;
  return `${entero.format(Math.round(Number(n)))} €`;
}

/** Lo que sale de media por cada persona en España. Aproximado y etiquetado. */
export function porHabitante(n) {
  if (!n || Number(n) <= 0) return null;
  const porPersona = Number(n) / HABITANTES;
  if (porPersona < 0.01) return null;
  if (porPersona < 1) return `${Math.round(porPersona * 100)} céntimos por persona`;
  if (porPersona < 100) return `${unDecimal.format(porPersona)} € por persona`;
  return `${entero.format(porPersona)} € por persona`;
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function aFecha(iso) {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(a, m - 1, d);
}

function diasDesdeHoy(iso) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.round((hoy - aFecha(iso)) / 86400000);
}

/** "hoy", "ayer", "hace 3 días", "12 sep". */
export function fechaCorta(iso) {
  if (!iso) return '';
  const dias = diasDesdeHoy(iso);
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 7) return `hace ${dias} días`;
  const f = aFecha(iso);
  return `${f.getDate()} ${MESES[f.getMonth()].slice(0, 3)}`;
}

/** "viernes, 12 de septiembre de 2026". */
export function fechaLarga(iso) {
  if (!iso) return '';
  const f = aFecha(iso);
  return `${DIAS[f.getDay()]}, ${f.getDate()} de ${MESES[f.getMonth()]} de ${f.getFullYear()}`;
}

/** "Hoy", "Ayer" o la fecha larga con mayúscula inicial. */
export function tituloDeDia(iso) {
  const dias = diasDesdeHoy(iso);
  if (dias === 0) return 'Hoy';
  if (dias === 1) return 'Ayer';
  const larga = fechaLarga(iso);
  return larga.charAt(0).toUpperCase() + larga.slice(1);
}

export const NOMBRES_CATEGORIA = {
  contratos: 'Contrato',
  personas: 'Personas',
  subvenciones: 'Ayudas',
  presupuesto: 'Presupuesto',
};

export const NOMBRES_SUBTIPO = {
  nombramiento: 'Nombramiento',
  cese: 'Cese',
  'libre-designacion': 'Libre designación',
  empleo: 'Oposiciones',
  subvencion: 'Ayuda',
  convenio: 'Convenio',
  anuncio: 'Anuncio de contrato',
  norma: 'Norma con gasto',
};

/** Texto plano de un item, para buscar sin tildes ni mayúsculas. */
export function paraBuscar(item) {
  return [item.frase, item.titulo, item.organismo, item.adjudicatario, item.expediente]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function normalizarBusqueda(texto) {
  return String(texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}
