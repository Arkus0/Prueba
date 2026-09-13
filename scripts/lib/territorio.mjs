/**
 * De dónde es cada contrato.
 *
 * La Plataforma no publica el territorio en un campo limpio y fiable, así que
 * se deduce, y se deduce con orden: primero la dirección oficial del CODICE si
 * viene, y solo si no viene se tira del nombre del organismo y del dominio de
 * la plataforma que lo publica.
 *
 * Regla de la casa: lo que no se sabe, no se reparte a dedo. Si ninguna pista
 * es concluyente se devuelve null, se cuenta aparte y la pantalla lo dice.
 * Cada acierto guarda su `via` para poder auditarlo después.
 */

import { COMUNIDADES, PROVINCIAS, MUNICIPIOS } from './territorio-datos.mjs';

export { COMUNIDADES, PROVINCIAS };

const normalizar = (texto) => String(texto || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9ñ ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/* ------------------------- Nombres de provincia --------------------------- */

/** Nombre normalizado -> código de provincia, con las variantes bilingües. */
const POR_NOMBRE = new Map();
for (const [codigo, provincia] of Object.entries(PROVINCIAS)) {
  for (const variante of provincia.nombre.split('/')) POR_NOMBRE.set(normalizar(variante), codigo);
}
for (const [alias, codigo] of Object.entries({
  alava: '01', vizcaya: '48', guipuzcoa: '20', 'a coruna': '15', coruna: '15',
  gerona: '17', lerida: '25', orense: '32', baleares: '07', 'islas baleares': '07',
  castellon: '12', alicante: '03', valencia: '46', tenerife: '38',
  'santa cruz de tenerife': '38', 'las palmas': '35', 'gran canaria': '35',
})) POR_NOMBRE.set(alias, codigo);

/* ------------------ Entes autonómicos sin topónimo dentro ----------------- */

/**
 * Organismos cuyo nombre no lleva el sitio: el Servicio Andaluz de Salud no
 * dice "Andalucía" por ninguna parte. Van de más específico a más genérico.
 */
const ENTES = [
  ['servicio andaluz de salud', '01'], ['agencia publica andaluza', '01'], ['andaluz', '01'], ['andalucia', '01'],
  ['salud aragon', '02'], ['aragon', '02'], ['aragones', '02'],
  ['sespa', '03'], ['principado de asturias', '03'], ['asturias', '03'], ['asturiano', '03'],
  ['ib salut', '04'], ['ibsalut', '04'], ['illes balears', '04'], ['islas baleares', '04'], ['balear', '04'],
  ['servicio canario', '05'], ['cabildo', '05'], ['canarias', '05'], ['canario', '05'],
  ['cantabria', '06'], ['cantabro', '06'],
  ['sacyl', '07'], ['castilla y leon', '07'],
  ['sescam', '08'], ['castilla la mancha', '08'], ['castilla-la mancha', '08'],
  ['generalitat de catalunya', '09'], ['catsalut', '09'], ['catalunya', '09'], ['cataluna', '09'], ['catala', '09'],
  ['generalitat valenciana', '10'], ['comunitat valenciana', '10'], ['valenciana', '10'],
  ['servicio extremeno', '11'], ['extremadura', '11'], ['extremeno', '11'],
  ['sergas', '12'], ['consellaria', '12'], ['xunta', '12'], ['galicia', '12'], ['galego', '12'],
  ['canal de isabel ii', '13'], ['madrilena', '13'], ['comunidad de madrid', '13'], ['madrid', '13'],
  ['servicio murciano de salud', '14'], ['region de murcia', '14'], ['murcia', '14'],
  ['osasunbidea', '15'], ['navarra', '15'], ['nafarroa', '15'], ['navarro', '15'],
  ['osakidetza', '16'], ['euskal', '16'], ['eusko jaurlaritza', '16'], ['gobierno vasco', '16'],
  ['pais vasco', '16'], ['euskadi', '16'], ['vasco', '16'],
  ['la rioja', '17'], ['rioja', '17'],
  ['ceuta', '18'],
  ['melilla', '19'],
];

/* -------------------- Dominios de plataforma autonómica ------------------- */

/**
 * Quien publica en su propia plataforma está diciendo de dónde es.
 * contrataciondelestado.es NO entra: es la plataforma central y la usan también
 * ayuntamientos y comunidades, así que no dice nada del territorio.
 */
const DOMINIOS = {
  'contractaciopublica.cat': '09',
  'contractaciopublica.gencat.cat': '09',
  'contratacion.euskadi.eus': '16',
  'contratos-publicos.comunidad.madrid': '13',
  'juntadeandalucia.es': '01',
  'contratosdegalicia.gal': '12',
  'hacienda.navarra.es': '15',
  'larioja.org': '17',
  'contractaciopublica.caib.es': '04',
  'aragon.es': '02',
};

/* --------------------------- Ámbito estatal ------------------------------- */

/**
 * Organismos de toda España. No tienen provincia, y decirlo es la respuesta
 * correcta: meterlos en Madrid porque allí está la sede sería mentir.
 */
const ESTATALES = [
  'ministerio', 'adif', 'renfe', 'correos y telegrafos', 'tragsa', 'navantia', 'enaire', 'aena',
  'confederacion hidrografica', 'autoridad portuaria', 'puertos del estado', 'sociedad estatal',
  'agencia estatal', 'instituto nacional', 'seguridad social', 'guardia civil', 'policia nacional',
  'armada', 'ejercito', 'mando de apoyo', 'estado mayor', 'direccion general de carreteras',
  'patrimonio nacional', 'paradores', 'fabrica nacional de moneda', 'consejo superior de investigaciones',
  'instituto de salud carlos iii', 'instituto geografico nacional', 'aemet', 'boletin oficial del estado',
  'secretaria de estado', 'subsecretaria', 'universidad nacional de educacion a distancia',
];

/* -------------------------------- Público --------------------------------- */

const ccaaDeProvincia = (codigo) => PROVINCIAS[codigo]?.ccaa || null;

/** Una provincia a partir de un código postal: los dos primeros dígitos. */
export function provinciaDeCodigoPostal(codigo) {
  const dos = String(codigo || '').trim().padStart(5, '0').slice(0, 2);
  return PROVINCIAS[dos] ? dos : null;
}

/**
 * Una provincia a partir de un código NUTS español (ES300, ES-MD, ES51...).
 * Solo se acepta el NUTS3, que es el que equivale a provincia; los de nivel
 * superior se dejan pasar como comunidad más abajo.
 */
const NUTS3 = {
  ES111: '15', ES112: '27', ES113: '32', ES114: '36', ES120: '33', ES130: '39',
  ES211: '01', ES212: '20', ES213: '48', ES220: '31', ES230: '26',
  ES241: '22', ES242: '44', ES243: '50', ES300: '28',
  ES411: '05', ES412: '09', ES413: '24', ES414: '34', ES415: '37', ES416: '40', ES417: '42', ES418: '47', ES419: '49',
  ES421: '02', ES422: '13', ES423: '16', ES424: '19', ES425: '45',
  ES431: '06', ES432: '10', ES511: '08', ES512: '17', ES513: '25', ES514: '43',
  ES521: '03', ES522: '12', ES523: '46', ES530: '07',
  ES531: '07', ES532: '07', ES533: '07',
  ES611: '04', ES612: '11', ES613: '14', ES614: '18', ES615: '21', ES616: '23', ES617: '29', ES618: '41',
  ES620: '30', ES630: '51', ES640: '52',
  // Canarias por islas: El Hierro, La Gomera, La Palma y Tenerife son Santa
  // Cruz (38); Fuerteventura, Gran Canaria y Lanzarote son Las Palmas (35).
  ES703: '38', ES704: '35', ES705: '35', ES706: '38', ES707: '38', ES708: '35', ES709: '38',
};

export function provinciaDeNUTS(codigo) {
  const limpio = String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return NUTS3[limpio] || null;
}

/** Busca un nombre de municipio del INE dentro de un texto ya normalizado. */
function municipioEn(texto) {
  const palabras = texto.split(' ');
  for (let largo = Math.min(6, palabras.length); largo >= 1; largo -= 1) {
    for (let i = 0; i + largo <= palabras.length; i += 1) {
      const trozo = palabras.slice(i, i + largo).join(' ');
      if (trozo.length < 5) continue;
      const provincia = MUNICIPIOS.get(trozo);
      if (provincia) return provincia;
    }
  }
  return null;
}

const dominioDe = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};

/**
 * De dónde es esto. Devuelve `{ provincia, ccaa, via }`, `{ estatal: true }`
 * o `null` si ninguna pista es concluyente.
 *
 *   direccion: { nuts, postal, ciudad } tal como venga del CODICE, si viene.
 */
export function localizar({ organismo, url, direccion } = {}) {
  // 1. El dato oficial, cuando la Plataforma lo publica.
  if (direccion) {
    const porNuts = provinciaDeNUTS(direccion.nuts);
    if (porNuts) return { provincia: porNuts, ccaa: ccaaDeProvincia(porNuts), via: 'codice-nuts' };
    const porPostal = provinciaDeCodigoPostal(direccion.postal);
    if (porPostal) return { provincia: porPostal, ccaa: ccaaDeProvincia(porPostal), via: 'codice-postal' };
    if (direccion.ciudad) {
      const texto = normalizar(direccion.ciudad);
      const porNombre = POR_NOMBRE.get(texto) || municipioEn(texto);
      if (porNombre) return { provincia: porNombre, ccaa: ccaaDeProvincia(porNombre), via: 'codice-ciudad' };
    }
  }

  const nombre = normalizar(organismo);

  // 2. El nombre de una provincia, dicho con todas las letras.
  if (nombre) {
    for (const [texto, codigo] of POR_NOMBRE) {
      if (new RegExp(`(^| )${texto}( |$)`).test(nombre)) {
        return { provincia: codigo, ccaa: ccaaDeProvincia(codigo), via: 'provincia' };
      }
    }
  }

  // 3. Un municipio del INE dentro del nombre ("Ayuntamiento de Vinarós").
  if (nombre) {
    const porMunicipio = municipioEn(nombre);
    if (porMunicipio) return { provincia: porMunicipio, ccaa: ccaaDeProvincia(porMunicipio), via: 'municipio' };
  }

  // 4. Un ente autonómico conocido: comunidad sí, provincia no.
  if (nombre) {
    for (const [texto, ccaa] of ENTES) {
      if (nombre.includes(texto)) return { provincia: null, ccaa, via: 'ente' };
    }
  }

  // 5. La plataforma en la que publica.
  const ccaaDominio = DOMINIOS[dominioDe(url)];
  if (ccaaDominio) return { provincia: null, ccaa: ccaaDominio, via: 'dominio' };

  // 6. Organismo de toda España: no le corresponde ninguna provincia.
  if (nombre) {
    for (const texto of ESTATALES) if (nombre.includes(texto)) return { estatal: true, provincia: null, ccaa: null, via: 'estado' };
  }

  return null;
}

export const nombreDeCCAA = (codigo) => COMUNIDADES[codigo]?.nombre || null;
export const poblacionDeCCAA = (codigo) => COMUNIDADES[codigo]?.poblacion || null;
export const nombreDeProvincia = (codigo) => PROVINCIAS[codigo]?.nombre || null;
