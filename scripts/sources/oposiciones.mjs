/**
 * Detector de oposiciones abiertas.
 *
 * El sumario del BOE solo da el titular: "Resolución ... por la que se convoca
 * proceso selectivo...". Lo que a una persona le importa (cuántas plazas, qué
 * titulación hace falta, hasta cuándo puede apuntarse y por dónde) está dentro
 * del documento. Aquí lo bajamos y lo sacamos.
 *
 * Lo que no encontramos con seguridad se queda en null y la ficha lo dice:
 * el enlace al BOE está siempre a un toque.
 */

import { bajar } from '../lib/red.mjs';
import { parsearXML, buscar, texto as textoDe2 } from '../lib/xml.mjs';
import { sujetoYVerbo, recortar, numeroES } from '../lib/texto.mjs';

/**
 * Se incrementa cuando cambia la lógica de extracción. Las convocatorias
 * guardadas con una versión anterior se vuelven a leer una vez: así un bug
 * corregido no queda congelado durante meses en oposiciones.json.
 */
export const VERSION_EXTRACTOR_OPOSICIONES = 2;

/** Solo pedimos el texto completo de lo que parece una convocatoria de plazas. */
const PARECE_CONVOCATORIA =
  /se convoca|convocatoria de|pruebas selectivas|proceso selectivo|oferta de empleo/i;
const NO_ES_CONVOCATORIA =
  /lista[s]? (provisional|definitiva)|relaci[oó]n(?:\s+(?:provisional|definitiva))?\s+de\s+(personas\s+)?(?:admitid|excluid|aprobad)|tribunal|correcci[oó]n de errores|se corrig(?:e|en)\s+(?:el|los|la|las)?\s*errores|se eleva a definitiva|nombramiento de funcionarios|modificaci[oó]n de la composici[oó]n|se ampl[ií]a el plazo para aprobar la relaci[oó]n/i;

const NUMEROS = {
  un: 1, uno: 1, una: 1,
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, 'dieciséis': 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, veintiuna: 21, veintidos: 22, 'veintidós': 22,
  veintitres: 23, 'veintitrés': 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, 'veintiséis': 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30,
};

const aNumero = (palabra) => {
  const crudo = String(palabra ?? '').trim().toLowerCase();
  if (Object.hasOwn(NUMEROS, crudo)) return NUMEROS[crudo];
  return numeroES(crudo);
};

const PALABRAS_NUMERO = Object.keys(NUMEROS)
  .sort((a, b) => b.length - a.length)
  .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const VALOR_PLAZAS = `(?:\\d{1,3}(?:\\.\\d{3})*|\\d{1,5}|${PALABRAS_NUMERO})`;

const plazaValida = (valor) => {
  const n = aNumero(valor);
  return Number.isInteger(n) && n > 0 && n < 100000 ? n : null;
};

/** ¿Merece la pena bajar el documento entero? */
export function pareceConvocatoria(item) {
  if (item.subtipo !== 'empleo') return false;
  const t = item.titulo || '';
  if (NO_ES_CONVOCATORIA.test(t)) return false;
  return PARECE_CONVOCATORIA.test(t);
}

/**
 * Plazas convocadas.
 *
 * Hay anuncios universitarios cuyo anexo repite bloques como:
 *   "Número de plazas: Una. Plaza número: 22825."
 * El identificador 22825 NO son 22.825 plazas. Por eso el valor etiquetado se
 * captura de forma estricta (sin saltar al campo siguiente) y, cuando hay
 * varios bloques, se suman. Si existe un total explícito, manda ese total.
 */
export function plazasEn(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');

  const patronesTotal = [
    new RegExp(`n[úu]mero\\s+total\\s+de\\s+plazas\\s*[:\\-]?\\s*(${VALOR_PLAZAS})\\b`, 'i'),
    new RegExp(`(?:un\\s+)?total\\s+de\\s+(${VALOR_PLAZAS})\\s+plazas\\b`, 'i'),
    new RegExp(`total\\s+plazas\\s*[:\\-]?\\s*(${VALOR_PLAZAS})\\b`, 'i'),
  ];
  for (const patron of patronesTotal) {
    const m = t.match(patron);
    const n = m ? plazaValida(m[1]) : null;
    if (n) return n;
  }

  // En anexos con una ficha por plaza puede aparecer muchas veces. Sumamos
  // SOLO el valor inmediatamente posterior a la etiqueta "Número de plazas".
  const etiqueta = new RegExp(
    `n[úu]mero\\s+de\\s+plazas(?:\\s+convocadas?)?\\s*[:\\-]?\\s*(${VALOR_PLAZAS})\\b`,
    'gi',
  );
  const etiquetadas = [...t.matchAll(etiqueta)]
    .map((m) => plazaValida(m[1]))
    .filter((n) => n !== null);
  if (etiquetadas.length) {
    const suma = etiquetadas.reduce((a, b) => a + b, 0);
    if (suma > 0 && suma < 100000) return suma;
  }

  // Formas narrativas habituales. Estas expresiones exigen que la cifra esté
  // pegada semánticamente a "plazas"; nunca atraviesan "Plaza número".
  const patrones = [
    new RegExp(`se\\s+convocan?[^.]{0,150}?\\b(${VALOR_PLAZAS})\\s+plazas\\b`, 'i'),
    new RegExp(`(?:cubrir|proveer|ofertar?|provisi[óo]n de)[^.]{0,80}?\\b(${VALOR_PLAZAS})\\s+plazas\\b`, 'i'),
    new RegExp(`\\b(${VALOR_PLAZAS})\\s+plazas\\b`, 'i'),
  ];
  for (const patron of patrones) {
    const m = t.match(patron);
    const n = m ? plazaValida(m[1]) : null;
    if (n) return n;
  }

  return /\b(?:una|un|uno|1)\s+plaza\b/i.test(t) ? 1 : null;
}

/** "plazo de veinte días hábiles" -> { dias: 20, tipo: 'hábiles' }. */
export function plazoEn(texto) {
  // El texto real casi nunca dice "plazo de veinte días": dice "el plazo de
  // presentación de solicitudes será de veinte días hábiles".
  const m = texto.match(/plazo[^.]{0,90}?\bde\s+([a-záéíóúñ]+|\d{1,2})\s+d[ií]as\s+(h[áa]biles|naturales)/i);
  if (!m) return null;
  const dias = aNumero(m[1]);
  if (!dias || dias > 90) return null;
  return { dias, tipo: /h/i.test(m[2]) ? 'hábiles' : 'naturales' };
}

/**
 * Fecha límite aproximada. El cómputo oficial empieza el día siguiente al de
 * la publicación; los días hábiles excluyen sábados, domingos y festivos, y
 * los festivos cambian según dónde presentes. Por eso se marca como
 * aproximada y la ficha manda siempre al documento oficial.
 */
export function fechaLimite(fechaPublicacion, plazo) {
  if (!plazo) return null;
  const fecha = new Date(`${fechaPublicacion}T00:00:00Z`);
  let contados = 0;
  while (contados < plazo.dias) {
    fecha.setUTCDate(fecha.getUTCDate() + 1);
    const diaSemana = fecha.getUTCDay();
    if (plazo.tipo === 'naturales' || (diaSemana !== 0 && diaSemana !== 6)) contados += 1;
  }
  return fecha.toISOString().slice(0, 10);
}

const primeraFrase = (texto, patron, limite = 200) => {
  const m = texto.match(patron);
  if (!m) return null;
  const desde = texto.slice(m.index);
  const fin = desde.search(/\.\s/);
  return recortar((fin === -1 ? desde : desde.slice(0, fin + 1)).replace(/\s+/g, ' ').trim(), limite);
};

/** Saca de un texto completo todo lo que necesita quien quiere presentarse. */
export function detallesDesdeTexto(contenido) {
  const t = contenido.replace(/\s+/g, ' ');

  const grupo = t.match(/\b[Ss]ubgrupo\s+(A1|A2|B|C1|C2)\b/) || t.match(/\b[Gg]rupo\s+(A1|A2|B|C1|C2)\b/);
  const sistema = /concurso-oposici[oó]n/i.test(t) ? 'Concurso-oposición'
    : /\boposici[oó]n\b/i.test(t) ? 'Oposición'
    : /concurso de m[eé]ritos|\bconcurso\b/i.test(t) ? 'Concurso de méritos'
    : /proceso selectivo|pruebas selectivas/i.test(t) ? 'Proceso selectivo' : null;

  const acceso = [];
  if (/acceso libre|sistema general de acceso libre/i.test(t)) acceso.push('Acceso libre');
  if (/promoci[oó]n interna/i.test(t)) acceso.push('Promoción interna');
  if (/personas con discapacidad/i.test(t)) acceso.push('Reserva para personas con discapacidad');

  const tasa = t.match(/(?:tasa|derechos de examen)[^.]{0,120}?(\d{1,3}(?:\.\d{3})*,\d{2})\s*euros/i);

  const telematica = /[Ii]nscripci[oó]n de [Pp]ruebas [Ss]electivas|IPS|sede electr[oó]nica|punto de acceso general|administracion\.gob\.es/i.test(t);
  const modelo790 = /modelo\s*790/i.test(t);

  return {
    plazas: plazasEn(t),
    plazo: plazoEn(t),
    grupo: grupo ? grupo[1] : null,
    sistema,
    acceso,
    titulacion: primeraFrase(t, /(?:estar en posesi[oó]n|poseer)[^.]{0,20}?(?:del? |la )?t[ií]tul/i, 220),
    requisitos: primeraFrase(t, /[Nn]acionalidad|[Tt]ener cumplidos/, 200),
    tasa: tasa ? tasa[1] : null,
    comoApuntarse: telematica
      ? `Solicitud por internet${modelo790 ? ' (modelo 790)' : ''}, en la sede electrónica del organismo o en el punto de acceso general administracion.gob.es.`
      : modelo790
        ? 'Solicitud en el modelo 790, según indica la convocatoria.'
        : null,
  };
}

/** Una línea que se entienda de un vistazo. */
function fraseDeOposicion(c) {
  const plazas = c.plazas
    ? `convoca ${c.plazas.toLocaleString('es-ES')} ${c.plazas === 1 ? 'plaza' : 'plazas'}${c.grupo ? ` del subgrupo ${c.grupo}` : ''}`
    : `abre un proceso selectivo${c.sistema && c.sistema !== 'Proceso selectivo' ? ` por ${c.sistema.toLowerCase()}` : ''}`;
  const frase = sujetoYVerbo(c.organismo, plazas);
  return frase ? `${frase}.` : `Se convocan plazas de empleo público${c.plazas ? `: ${c.plazas}` : ''}.`;
}

const itemDesdeConvocatoriaGuardada = (c) => ({
  id: c.id,
  tipo: 'boe',
  subtipo: 'empleo',
  fecha: c.fecha,
  organismo: c.organismo,
  titulo: c.titulo,
  url: c.url || `https://www.boe.es/diario_boe/txt.php?id=${encodeURIComponent(c.id)}`,
  urlPdf: c.urlPdf || null,
  urlXml: `https://www.boe.es/diario_boe/xml.php?id=${encodeURIComponent(c.id)}`,
});

/**
 * Enriquece los items de empleo del BOE con lo que hay dentro del documento.
 * Las convocatorias extraídas con la versión actual no se vuelven a pedir.
 * Si cambia el extractor, las antiguas se revalidan una sola vez para evitar
 * que un error histórico siga publicado después de haber arreglado el parser.
 */
export async function leerOposiciones(items, yaConocidas = [], registro = console) {
  const conocidasVigentes = new Map(
    yaConocidas
      .filter((c) => c.extractorVersion === VERSION_EXTRACTOR_OPOSICIONES)
      .map((c) => [c.id, c]),
  );

  const porId = new Map();
  for (const item of items.filter(pareceConvocatoria)) porId.set(item.id, item);

  // Migración automática: versiones antiguas vuelven a pasar por el parser.
  // Los falsos positivos que ya no son convocatoria no se descargan; se
  // eliminan después en marcarAbiertas().
  for (const vieja of yaConocidas) {
    if (vieja.extractorVersion === VERSION_EXTRACTOR_OPOSICIONES) continue;
    const item = itemDesdeConvocatoriaGuardada(vieja);
    if (pareceConvocatoria(item) && !porId.has(item.id)) porId.set(item.id, item);
  }

  const candidatas = [...porId.values()];
  const nuevas = [];
  let errores = 0;

  for (const item of candidatas) {
    if (conocidasVigentes.has(item.id)) continue;
    try {
      const xml = await bajar(item.urlXml, { intentos: 2, tiempoLimiteMs: 30000 });
      const documento = parsearXML(xml);
      const cuerpo = buscar(documento, 'texto');
      const contenido = textoDe2(cuerpo || documento);
      if (!contenido || contenido.length < 200) continue;

      const detalles = detallesDesdeTexto(contenido);
      const convocatoria = {
        id: item.id,
        tipo: 'oposicion',
        fecha: item.fecha,
        organismo: item.organismo,
        titulo: item.titulo,
        ...detalles,
        extractorVersion: VERSION_EXTRACTOR_OPOSICIONES,
        limite: fechaLimite(item.fecha, detalles.plazo),
        url: item.url,
        urlPdf: item.urlPdf,
      };
      convocatoria.frase = fraseDeOposicion(convocatoria);
      nuevas.push(convocatoria);
    } catch (error) {
      errores += 1;
      registro.warn?.(`  ⚠ oposición ${item.id}: ${error.message || error}`);
    }
  }

  registro.log?.(`  Oposiciones: ${nuevas.length} convocatorias nuevas o revalidadas de ${candidatas.length} candidatas${errores ? `, ${errores} con error` : ''}`);
  return { nuevas, errores, candidatas: candidatas.length };
}

/** Marca cuáles siguen abiertas hoy y descarta falsos positivos conocidos. */
export function marcarAbiertas(convocatorias, hoy = new Date().toISOString().slice(0, 10)) {
  return convocatorias
    .filter((c) => pareceConvocatoria({ subtipo: 'empleo', titulo: c.titulo || '' }))
    .map((c) => ({ ...c, abierta: Boolean(c.limite) && c.limite >= hoy }));
}
