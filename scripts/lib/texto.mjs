/**
 * Capa de traduccion: de como escribe la Administracion a como habla la gente.
 * Aqui viven los numeros, la jerga y las frases de una linea.
 */

/** "1.234.567,89" -> 1234567.89 (formato espanol, con puntos de millar). */
export function numeroES(cadena) {
  if (cadena === null || cadena === undefined) return null;
  const limpio = String(cadena).replace(/\s| /g, '');
  if (!/[\d]/.test(limpio)) return null;
  const n = Number(limpio.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Importes de los XML CODICE. El formato de la norma es "1234567.89" con punto
 * decimal, pero algunos organismos publican a la espanola. Distinguimos por la
 * forma exacta de la cadena y, si no encaja en ninguna, devolvemos null.
 *
 * Antes esto caia en numeroES, que quita los puntos por considerarlos
 * separadores de millar: un contrato de 16.754.259,84 EUR acababa publicado
 * como 1.675.425.984 EUR. Mejor no dar cifra que dar una cifra de mas.
 */
export function numeroCodice(cadena) {
  if (cadena === null || cadena === undefined) return null;
  const limpio = String(cadena).trim().replace(/[\s\u00a0]/g, '');
  if (limpio === '') return null;

  // Formato CODICE: 1234567.89 (un unico punto, decimal)
  if (/^-?\d+(\.\d{1,6})?$/.test(limpio)) return finito(Number(limpio));

  // Formato espanol con separador de millares: 1.234.567,89
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(limpio)) return numeroES(limpio);

  // Coma decimal sin millares: 1234567,89
  if (/^-?\d+,\d{1,6}$/.test(limpio)) return finito(Number(limpio.replace(',', '.')));

  return null;
}

function finito(n) {
  return Number.isFinite(n) ? n : null;
}

/**
 * Busca un importe en euros dentro de un texto libre (titulos del BOE).
 * Devuelve { importe, literal } o null. Solo acepta cifras acompanadas de
 * euros o del simbolo: nunca adivina.
 */
export function importeEnTexto(texto) {
  if (!texto) return null;
  const fuente = String(texto);

  const conPalabra = fuente.match(
    /(\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:,\d+)?)\s*(mil millones|millones?)?\s*(?:de\s+)?(?:euros?|€)/i,
  );
  if (conPalabra) {
    let valor = numeroES(conPalabra[1]);
    if (valor === null) return null;
    if (conPalabra[2]) {
      const factor = /mil\s+millones/i.test(conPalabra[2]) ? 1e9 : 1e6;
      valor *= factor;
    }
    return { importe: valor, literal: conPalabra[0].trim() };
  }

  const simboloDelante = fuente.match(/€\s*(\d{1,3}(?:\.\d{3})*(?:,\d+)?)/);
  if (simboloDelante) {
    const valor = numeroES(simboloDelante[1]);
    if (valor !== null) return { importe: valor, literal: simboloDelante[0].trim() };
  }
  return null;
}

/** Quita el ruido tipico de los titulos oficiales sin perder informacion. */
export function limpiarTitulo(titulo) {
  if (!titulo) return '';
  return String(titulo)
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

/** Primera letra en mayuscula, respetando siglas. */
export function capitalizar(texto) {
  if (!texto) return '';
  const t = String(texto).trim();
  if (t === t.toUpperCase() && t.length > 3) {
    // TITULOS EN MAYUSCULAS: los pasamos a capital inicial por palabra.
    return t.toLowerCase().replace(/(^|[\s(«"'-])([a-záéíóúñ])/g, (m, pre, letra) => pre + letra.toUpperCase());
  }
  return t[0].toUpperCase() + t.slice(1);
}

/** Nombres de organismo en MAYUSCULAS -> legibles, manteniendo siglas cortas. */
export function nombrePropio(texto) {
  if (!texto) return '';
  const menores = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'para', 'por', 'a', 'al', 'con']);
  return String(texto)
    .trim()
    .toLowerCase()
    .split(/(\s+|[-/()])/)
    .map((trozo, i) => {
      if (!/[a-záéíóúñ]/.test(trozo)) return trozo;
      if (i > 0 && menores.has(trozo)) return trozo;
      return trozo[0].toUpperCase() + trozo.slice(1);
    })
    .join('')
    .replace(SIGLAS_EMPRESA, (sigla) => sigla.replace(/[.\s]/g, '').toUpperCase())
    .replace(ACRONIMOS, (a) => a.toUpperCase());
}

/** S.A., s.l.u., S. A. ... al final de un nombre de empresa. */
const SIGLAS_EMPRESA = /\b(s\.?\s?[al]\.?u?\.?|s\.?\s?c\.?\s?p?\.?)(?=$|[\s,;)])/gi;

/** Formas societarias y siglas que no se escriben como palabra. */
const ACRONIMOS = /\b(sme|aie|ute|slp|sam|scl|scoop|ong|ceip|ies|cra|epe|eppe|epel|mp|sau|slu)\b/gi;

/**
 * Género del nombre de un organismo, por la terminación de su primera palabra.
 * Una lista de excepciones se queda corta enseguida ("Alcaldía", "Consejería",
 * "Diputación"...); la regla de terminación acierta casi siempre.
 */
export function esFemenino(nombre) {
  const primera = String(nombre || '').trim().split(/[\s,]/)[0]
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return generoDePalabra(primera) === 'f';
}

const GENERO_A_MANO = { cortes: 'f', aguas: 'f', costas: 'f', obras: 'f', juzgados: 'm', tribunales: 'm' };

function generoDePalabra(palabra) {
  if (GENERO_A_MANO[palabra]) return GENERO_A_MANO[palabra];
  if (/^(dia|mapa|tranvia)$/.test(palabra)) return 'm';            // día, mapa
  if (/(ma|ema|ama|oma|ista)$/.test(palabra)) return 'm';          // programa, sistema, periodista
  return /(a|cion|sion|dad|tad|tud|ez|umbre|ie)$/.test(palabra) ? 'f' : 'm';
}

/** Palabras que en castellano acaban en -s sin ser plurales. */
const SINGULARES_EN_S = /^(pais|analisis|interes|ingles|frances|jueves|martes|lunes|viernes|cadiz|badajoz)$/;

/**
 * Género y número de un organismo, para que el artículo y el verbo concuerden.
 * "UNIVERSIDADES" tiene que dar "las Universidades ... abren", no "el ... abre".
 */
export function analizarOrganismo(organismo) {
  if (!organismo) return null;
  const nombre = nombrePropio(organismo);
  const primera = nombre.trim().split(/[\s,]/)[0]
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const plural = /(es|as|os)$/.test(primera) && primera.length > 4 && !SINGULARES_EN_S.test(primera);
  const singular = plural ? primera.replace(/es$/, '').replace(/s$/, '') : primera;
  const femenino = generoDePalabra(plural ? primera : singular) === 'f'
    || (plural && generoDePalabra(singular) === 'f');

  const articulo = plural ? (femenino ? 'las' : 'los') : (femenino ? 'la' : 'el');
  return { nombre, plural, femenino, articulo, con: `${articulo} ${nombre}` };
}

/** Palabras que no son el verbo aunque vayan delante. */
const ANTES_DEL_VERBO = new Set(['no', 'ya', 'aun', 'aún', 'todavia', 'todavía', 'solo', 'sólo']);

/**
 * "MINISTERIO DE X" + "abre" -> "El Ministerio de X abre".
 * "UNIVERSIDADES"  + "abre" -> "Las Universidades abren".
 */
export function sujetoYVerbo(organismo, verbo) {
  const datos = analizarOrganismo(organismo);
  if (!datos) return null;
  const sujeto = datos.con.charAt(0).toUpperCase() + datos.con.slice(1);
  if (!datos.plural) return `${sujeto} ${verbo}`;

  // El plural de presente se forma añadiendo una "n" (abre -> abren). En
  // pasado no (encontró -> encontraron), así que ahí no tocamos nada: las
  // frases que generamos están todas en presente a propósito.
  let conjugado = false;
  const enPlural = verbo.split(' ').map((palabra) => {
    if (conjugado || ANTES_DEL_VERBO.has(palabra.toLowerCase())) return palabra;
    conjugado = true;
    if (palabra.endsWith('n') || /[áéíóú]$/.test(palabra)) return palabra;
    return `${palabra}n`;
  }).join(' ');
  return `${sujeto} ${enPlural}`;
}

/** "Ministerio de Defensa" -> "el Ministerio de Defensa". */
export function conArticuloOrganismo(organismo) {
  const datos = analizarOrganismo(organismo);
  return datos ? datos.con : null;
}

/** Corta un texto largo por la última palabra entera. */
export function recortar(texto, maximo = 120) {
  const limpio = String(texto || '').trim();
  if (limpio.length <= maximo) return limpio;
  const corte = limpio.slice(0, maximo);
  const espacio = corte.lastIndexOf(' ');
  return `${corte.slice(0, espacio > maximo * 0.6 ? espacio : maximo).replace(/[\s,;:.]+$/, '')}…`;
}

/** Igual, pero para empezar una frase. */
export function conArticuloMayus(organismo) {
  const con = conArticuloOrganismo(organismo);
  return con ? con[0].toUpperCase() + con.slice(1) : null;
}

/**
 * Glosario: cada termino oficial, con una explicacion corta (la que se ve
 * al tocarlo) y una larga. Se publica tambien como data/glosario.json.
 */
export const GLOSARIO = {
  'libre designacion': {
    termino: 'Libre designación',
    breve: 'Lo elige el órgano que nombra, sin baremo de méritos puntuado.',
    largo: 'Es una forma legal de cubrir puestos de responsabilidad en la Administración. En vez de ordenar a los candidatos por méritos y nota, como en un concurso, el cargo elige a quien quiere entre quienes cumplen los requisitos mínimos, y puede cesarle cuando quiera. Es un procedimiento legal y habitual en puestos de confianza; lo interesante es saber cuántos puestos se cubren así y en qué organismos.',
  },
  'concurso': {
    termino: 'Concurso',
    breve: 'El puesto se da por méritos puntuados, no por decisión personal.',
    largo: 'Sistema para cubrir puestos en el que los candidatos se ordenan por una baremación pública: experiencia, antigüedad, formación, cursos. Gana quien más puntos suma. Es lo contrario de la libre designación.',
  },
  'oposicion': {
    termino: 'Oposición',
    breve: 'Exámenes para entrar como funcionario: gana la nota.',
    largo: 'Proceso selectivo con pruebas para entrar en la función pública. El concurso-oposición mezcla exámenes con méritos ya acumulados (experiencia previa, por ejemplo).',
  },
  'cese': {
    termino: 'Cese',
    breve: 'Se le retira el puesto a alguien, con o sin motivo publicado.',
    largo: 'Fin del nombramiento en un puesto. En los puestos de libre designación puede producirse en cualquier momento y el BOE no suele explicar la razón.',
  },
  'procedimiento abierto': {
    termino: 'Procedimiento abierto',
    breve: 'Concurso normal: puede presentarse cualquier empresa.',
    largo: 'La forma ordinaria de contratar: se publica el contrato, cualquier empresa que cumpla los requisitos puede presentar oferta y gana la mejor según los criterios publicados. Es el procedimiento con más competencia.',
  },
  'negociado sin publicidad': {
    termino: 'Negociado sin publicidad',
    breve: 'Sin anuncio previo: la Administración habla solo con quien elige.',
    largo: 'La Administración invita directamente a una o varias empresas y negocia con ellas, sin publicar antes el contrato. La ley solo lo permite en casos tasados (urgencia, que solo exista un proveedor posible, contratos declarados desiertos…). Es legal, pero es el procedimiento con menos competencia, así que conviene mirarlo.',
  },
  'contrato menor': {
    termino: 'Contrato menor',
    breve: 'Contrato pequeño que se adjudica directamente, sin concurso.',
    largo: 'Contratos por debajo de cierto importe (40.000 € en obras y 15.000 € en servicios y suministros, sin IVA) que pueden adjudicarse directamente a una empresa. Son rápidos y legales; el riesgo conocido es trocear un gasto grande en muchos contratos menores para evitar el concurso.',
  },
  'acuerdo marco': {
    termino: 'Acuerdo marco',
    breve: 'Lista cerrada de empresas a las que luego se les va comprando.',
    largo: 'Se selecciona por concurso a un grupo de empresas y, durante unos años, los pedidos concretos se reparten entre ellas sin volver a licitar desde cero.',
  },
  'desierto': {
    termino: 'Desierto',
    breve: 'Nadie se presentó o ninguna oferta valía: el contrato se queda sin adjudicar.',
    largo: 'El contrato se publica pero no se adjudica, porque no hubo ofertas o ninguna cumplía. Suele abrir la puerta a repetirlo por un procedimiento con menos publicidad.',
  },
  'licitacion': {
    termino: 'Licitación',
    breve: 'El concurso en el que las empresas compiten por un contrato.',
    largo: 'Todo el proceso desde que la Administración publica lo que quiere comprar hasta que elige empresa.',
  },
  'adjudicacion': {
    termino: 'Adjudicación',
    breve: 'El momento en que se decide qué empresa se queda el contrato.',
    largo: 'Resolución que asigna el contrato a una empresa por un importe concreto. Hasta entonces solo hay un presupuesto previsto.',
  },
  'organo de contratacion': {
    termino: 'Órgano de contratación',
    breve: 'Quien firma y paga: el ministerio, hospital o entidad concreta.',
    largo: 'La unidad de la Administración con capacidad para firmar ese contrato. No es "el Estado" en abstracto: es una dirección general, un hospital, una universidad o una empresa pública concreta.',
  },
  'valor estimado': {
    termino: 'Valor estimado',
    breve: 'Lo máximo que puede llegar a costar, prórrogas incluidas.',
    largo: 'Cálculo del coste total del contrato incluyendo posibles prórrogas y modificaciones, sin IVA. Suele ser mayor que el presupuesto de salida.',
  },
  'sin iva': {
    termino: 'Sin IVA',
    breve: 'La cifra no incluye el impuesto; lo pagado es algo más.',
    largo: 'Los importes de contratación se publican normalmente sin IVA. Con IVA general (21%), lo que sale de la caja pública es aproximadamente un 21% más.',
  },
  'subvencion': {
    termino: 'Subvención',
    breve: 'Dinero público entregado sin recibir un producto a cambio.',
    largo: 'Entrega de dinero a una persona, empresa o entidad para una finalidad de interés público, sin contraprestación directa. Puede repartirse en concurrencia competitiva (compiten solicitudes) o de forma nominativa (va a un beneficiario concreto ya decidido).',
  },
  'concurrencia competitiva': {
    termino: 'Concurrencia competitiva',
    breve: 'Las ayudas se reparten comparando solicitudes con criterios públicos.',
    largo: 'Forma de repartir subvenciones en la que se publican las bases, se presentan solicitudes y se ordenan por puntuación hasta agotar el dinero.',
  },
  'convenio': {
    termino: 'Convenio',
    breve: 'Acuerdo entre administraciones o con entidades, a menudo con dinero.',
    largo: 'Acuerdo de colaboración que no es un contrato ni una subvención al uso, pero que muchas veces mueve dinero público. Se publica en el BOE con su importe y su plazo.',
  },
  'encargo a medio propio': {
    termino: 'Encargo a medio propio',
    breve: 'El trabajo se da a una empresa pública sin concurso.',
    largo: 'La Administración encarga el trabajo a una empresa o entidad de su propiedad (Tragsa, Ineco, Isdefe…) sin licitación, porque legalmente se considera una prolongación de sí misma. Legal, pero saca ese dinero del circuito de competencia.',
  },
  'real decreto': {
    termino: 'Real decreto',
    breve: 'Norma aprobada por el Gobierno, por debajo de la ley.',
    largo: 'Norma del Consejo de Ministros. Cuando reparte dinero (créditos extraordinarios, transferencias a comunidades), el importe aparece en el propio texto.',
  },
  'credito extraordinario': {
    termino: 'Crédito extraordinario',
    breve: 'Dinero añadido fuera de lo presupuestado.',
    largo: 'Gasto que no estaba en el presupuesto y se aprueba aparte durante el año. Suele ir acompañado de la explicación de de dónde sale ese dinero.',
  },
};

const PATRONES_JERGA = [
  [/libre designaci[oó]n/i, 'libre designacion'],
  [/\bconcurso[- ]oposici[oó]n\b|\boposici[oó]n(es)?\b|proceso selectivo/i, 'oposicion'],
  [/\bconcurso\b/i, 'concurso'],
  [/\bcese\b|\bcesa\b/i, 'cese'],
  [/procedimiento abierto|\babierto simplificado\b/i, 'procedimiento abierto'],
  [/negociado sin publicidad|sin publicidad/i, 'negociado sin publicidad'],
  [/contratos? menores?/i, 'contrato menor'],
  [/acuerdo marco|sistema din[aá]mico/i, 'acuerdo marco'],
  [/desierto|desierta/i, 'desierto'],
  [/licitaci[oó]n/i, 'licitacion'],
  [/adjudicaci[oó]n|adjudica\b/i, 'adjudicacion'],
  [/[oó]rgano de contrataci[oó]n/i, 'organo de contratacion'],
  [/valor estimado/i, 'valor estimado'],
  [/subvenci[oó]n|subvenciones|ayudas?\b|becas?\b/i, 'subvencion'],
  [/concurrencia competitiva/i, 'concurrencia competitiva'],
  [/convenio/i, 'convenio'],
  [/medio propio|encargo a\b/i, 'encargo a medio propio'],
  [/real decreto/i, 'real decreto'],
  [/cr[eé]dito extraordinario|suplemento de cr[eé]dito/i, 'credito extraordinario'],
];

/** Terminos del glosario que aparecen en un texto, sin repetir. */
export function jergaEn(texto) {
  if (!texto) return [];
  const encontrados = [];
  for (const [patron, clave] of PATRONES_JERGA) {
    if (patron.test(texto) && !encontrados.includes(clave)) encontrados.push(clave);
  }
  return encontrados;
}
