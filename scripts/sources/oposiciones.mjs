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

/** Solo pedimos el texto completo de lo que parece una convocatoria de plazas. */
const PARECE_CONVOCATORIA =
  /se convoca|convocatoria de|pruebas selectivas|proceso selectivo|oferta de empleo/i;
const NO_ES_CONVOCATORIA =
  /lista[s]? (provisional|definitiva)|relación de (personas )?aprobad|tribunal|corrección de errores|se eleva a definitiva|nombramiento de funcionarios|modificación de la composición/i;

const NUMEROS = {
  un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  veinte: 20, treinta: 30,
};

const aNumero = (palabra) => NUMEROS[String(palabra).toLowerCase()] ?? Number(palabra) ?? null;

/** ¿Merece la pena bajar el documento entero? */
export function pareceConvocatoria(item) {
  if (item.subtipo !== 'empleo') return false;
  const t = item.titulo || '';
  if (NO_ES_CONVOCATORIA.test(t)) return false;
  return PARECE_CONVOCATORIA.test(t);
}

/**
 * Plazas convocadas. Se prueban varias formas, de la más fiable a la más
 * general, y se aceptan cifras con separador de millar ("1.115 plazas").
 */
export function plazasEn(texto) {
  const patrones = [
    /(?:un\s+)?total\s+de\s+([\d.]{1,9})\s+plazas/i,
    /n[úu]mero\s+(?:total\s+)?de\s+plazas[^\d]{0,25}([\d.]{1,9})/i,
    /se\s+convocan?[^.]{0,150}?\b([\d.]{1,9})\s+plazas/i,
    /(?:cubrir|proveer|ofertar?|provisi[óo]n de)[^.]{0,80}?\b([\d.]{1,9})\s+plazas/i,
    /\b([\d.]{1,9})\s+plazas\b/i,
  ];
  for (const patron of patrones) {
    const m = texto.match(patron);
    if (!m) continue;
    const n = numeroES(m[1]);
    if (n && n > 0 && n < 100000 && Number.isInteger(n)) return n;
  }
  return /\b(?:una|1)\s+plaza\b/i.test(texto) ? 1 : null;
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

/**
 * Enriquece los items de empleo del BOE con lo que hay dentro del documento.
 * Solo baja los que no conocemos ya: el histórico no se vuelve a pedir.
 */
export async function leerOposiciones(items, yaConocidas = [], registro = console) {
  const conocidas = new Map(yaConocidas.map((c) => [c.id, c]));
  const candidatas = items.filter(pareceConvocatoria);
  const nuevas = [];
  let errores = 0;

  for (const item of candidatas) {
    if (conocidas.has(item.id)) continue;
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

  registro.log?.(`  Oposiciones: ${nuevas.length} convocatorias nuevas de ${candidatas.length} candidatas${errores ? `, ${errores} con error` : ''}`);
  return { nuevas, errores, candidatas: candidatas.length };
}

/** Marca cuáles siguen abiertas hoy. */
export function marcarAbiertas(convocatorias, hoy = new Date().toISOString().slice(0, 10)) {
  return convocatorias.map((c) => ({ ...c, abierta: Boolean(c.limite) && c.limite >= hoy }));
}
