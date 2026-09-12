/**
 * Senales: hechos objetivos que merecen una mirada, nunca acusaciones.
 * Cada una explica que significa y, sobre todo, que NO significa.
 */

export const SENALES = {
  'sin-competencia': {
    etiqueta: 'Sin concurso abierto',
    tono: 'aviso',
    explica: 'Se adjudicó sin publicar antes un concurso al que pudiera presentarse cualquiera. La ley lo permite en casos concretos (urgencia, proveedor único, concurso desierto). No es una irregularidad: es una decisión que quita competencia y por eso se señala.',
  },
  'un-licitador': {
    etiqueta: 'Una sola oferta',
    tono: 'aviso',
    explica: 'Hubo concurso, pero solo se presentó una empresa. Puede ser un mercado con un único proveedor capaz, o unas condiciones tan ajustadas que nadie más pudo competir.',
  },
  'contrato-menor': {
    etiqueta: 'Contrato menor',
    tono: 'info',
    explica: 'Contrato pequeño que se puede adjudicar directamente, sin concurso. Es legal y muy común. Lo que conviene vigilar es que un gasto grande no se trocee en muchos contratos menores.',
  },
  'importe-alto': {
    etiqueta: 'Importe grande',
    tono: 'info',
    explica: 'Supera el millón de euros. Lo marcamos solo para que no pase desapercibido entre contratos pequeños.',
  },
  'desierto': {
    etiqueta: 'Quedó desierto',
    tono: 'info',
    explica: 'No se adjudicó a nadie: no hubo ofertas o ninguna servía. Suele repetirse después con otro procedimiento, a menudo con menos publicidad.',
  },
  'medio-propio': {
    etiqueta: 'A una empresa pública',
    tono: 'info',
    explica: 'El trabajo se encarga a una empresa del propio sector público (Tragsa, Ineco, Isdefe…) sin concurso, porque legalmente cuenta como parte de la Administración. Legal, pero ese dinero no pasa por el mercado.',
  },
  'modificado': {
    etiqueta: 'Contrato modificado',
    tono: 'aviso',
    explica: 'El contrato se cambió después de firmarse. Las modificaciones suelen subir el precio o alargar el plazo respecto de lo que se adjudicó.',
  },
  'libre-designacion': {
    etiqueta: 'Libre designación',
    tono: 'aviso',
    explica: 'El puesto se cubre por libre designación: el órgano que nombra elige entre quienes cumplen los requisitos, sin baremo de méritos puntuado, y puede cesar a esa persona en cualquier momento. Es un procedimiento legal y habitual en puestos de confianza; lo señalamos porque cambia quién decide, no porque haya nada irregular.',
  },
  'por-concurso': {
    etiqueta: 'Por concurso',
    tono: 'bueno',
    explica: 'El puesto se cubre ordenando a los candidatos por méritos puntuados y publicados, no por decisión personal.',
  },
  'cese': {
    etiqueta: 'Cese',
    tono: 'neutro',
    explica: 'Se retira a alguien de su puesto. En los puestos de libre designación puede hacerse en cualquier momento y el BOE no suele publicar el motivo.',
  },
  'sin-importe': {
    etiqueta: 'Sin importe publicado',
    tono: 'neutro',
    explica: 'El documento oficial no incluye una cifra en euros que podamos leer automáticamente. Puede estar dentro del PDF; por eso dejamos siempre el enlace al original.',
  },
};

export const IMPORTE_ALTO = 1_000_000;

/** Procedimientos que, segun el codigo CODICE, no compiten en abierto. */
const PROCEDIMIENTOS_SIN_COMPETENCIA = new Set(['4', '6', '9', '100']);

/**
 * Calcula las senales de un contrato ya normalizado.
 * Solo mira campos existentes: si un dato falta, no inventa la senal.
 */
export function senalesDeContrato(contrato) {
  const claves = [];
  const texto = `${contrato.objeto || ''} ${contrato.procedimiento || ''} ${contrato.estado || ''}`.toLowerCase();

  if (
    PROCEDIMIENTOS_SIN_COMPETENCIA.has(String(contrato.procedimientoCodigo)) ||
    /sin publicidad|negociado sin|adjudicaci[oó]n directa/.test(texto)
  ) claves.push('sin-competencia');

  if (contrato.ofertas === 1) claves.push('un-licitador');
  if (contrato.esMenor || /contrato menor/.test(texto)) claves.push('contrato-menor');
  if (/medio propio|tragsa|ineco|isdefe|tragsatec|segipsa|indra sistemas de seguridad/.test(texto)) claves.push('medio-propio');
  if (/desierto|desierta/.test(texto) || String(contrato.resultadoCodigo) === '3') claves.push('desierto');
  if (/modificaci[oó]n|modificado/.test(texto)) claves.push('modificado');

  const importe = contrato.importeAdjudicado ?? contrato.importe;
  if (typeof importe === 'number' && importe >= IMPORTE_ALTO) claves.push('importe-alto');
  if (importe === null || importe === undefined) claves.push('sin-importe');

  return claves;
}

/** Senales de un item del BOE (personas, subvenciones, normas). */
export function senalesDeBOE(item) {
  const claves = [];
  const texto = `${item.titulo || ''}`.toLowerCase();

  if (/libre designaci[oó]n/.test(texto)) claves.push('libre-designacion');
  else if (/\bconcurso\b/.test(texto) && item.categoria === 'personas') claves.push('por-concurso');
  if (/\bcese\b|se dispone el cese|cesa\b/.test(texto)) claves.push('cese');
  if (typeof item.importe === 'number' && item.importe >= IMPORTE_ALTO) claves.push('importe-alto');

  return claves;
}
