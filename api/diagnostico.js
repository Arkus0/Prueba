/**
 * Comprobación de fuentes, a demanda.
 *
 * La ingesta de verdad corre una vez al día en GitHub Actions. Este endpoint
 * existe para responder a una pregunta puntual sin esperar al cron: ¿siguen
 * respondiendo el BOE y la Plataforma de Contratación, y seguimos entendiendo
 * lo que devuelven? Devuelve el estado de cada fuente y una muestra pequeña.
 *
 *   /api/diagnostico                  las dos fuentes, 1 día, 1 página
 *   /api/diagnostico?fuente=boe&dias=2
 *   /api/diagnostico?fuente=placsp&paginas=2
 */

import { bajar } from '../scripts/lib/red.mjs';
import { parsearXML, buscarTodos } from '../scripts/lib/xml.mjs';
import { sumarioDelDia } from '../scripts/sources/boe.mjs';
import { leerFeed, FEEDS } from '../scripts/sources/placsp.mjs';
import { ultimosDias, comoISO } from '../scripts/lib/red.mjs';


const mudo = { log() {}, warn() {} };

async function probarBOE(dias) {
  const items = [];
  const errores = [];
  for (const fecha of ultimosDias(dias)) {
    try {
      const sumario = await sumarioDelDia(fecha, mudo);
      items.push(...sumario.items);
    } catch (error) {
      errores.push(`${comoISO(fecha)}: ${error.message || error}`);
    }
  }
  const porCategoria = {};
  for (const i of items) porCategoria[i.categoria] = (porCategoria[i.categoria] || 0) + 1;
  return {
    estado: items.length ? 'ok' : 'sin-datos',
    registros: items.length,
    porCategoria,
    conFrase: items.filter((i) => i.frase).length,
    conImporte: items.filter((i) => i.importe !== null).length,
    errores,
    muestra: items.slice(0, 5),
  };
}

async function probarPLACSP(paginas, dias) {
  const salida = {};
  for (const feed of FEEDS) {
    try {
      const contratos = await leerFeed(feed, dias, mudo, paginas);
      const campo = (nombre) => contratos.filter((c) => c[nombre] !== null && c[nombre] !== undefined).length;
      const porNivel = {};
      for (const c of contratos) porNivel[c.nivel || 'desconocido'] = (porNivel[c.nivel || 'desconocido'] || 0) + 1;
      salida[feed.clave] = {
        estado: contratos.length ? 'ok' : 'sin-datos',
        registros: contratos.length,
        fechas: [...new Set(contratos.map((c) => c.fecha))].sort().slice(-5),
        camposLeidos: {
          organismo: campo('organismo'),
          objeto: campo('objeto'),
          importe: campo('importe'),
          procedimiento: campo('procedimiento'),
          adjudicatario: campo('adjudicatario'),
          estado: campo('estado'),
        },
        porNivel,
        importeTotal: Math.round(contratos.reduce((t, c) => t + (c.importeAdjudicado ?? c.importe ?? 0), 0)),
        sinCompetencia: contratos.filter((c) => c.senales.includes('sin-competencia')).length,
        muestra: contratos.slice(0, 3).map((c) => ({ frase: c.frase, importe: c.importe, procedimiento: c.procedimiento, estado: c.estado, nivel: c.nivel, adjudicatario: c.adjudicatario })),
      };
    } catch (error) {
      salida[feed.clave] = { estado: 'error', mensaje: String(error.message || error) };
    }
  }
  return salida;
}

/** Candidatas de la sindicación, por si la Plataforma mueve las rutas. */
const CANDIDATAS = [
  'https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom',
  'https://contrataciondelestado.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom',
  'https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_1143/contratosMenoresPerfilesContratantes.atom',
  'https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_1044/PlataformasAgregadasSinMenores.atom',
];

/** Qué devuelve de verdad cada URL, sin interpretar nada. */
async function probarCrudo() {
  const salida = [];
  for (const url of CANDIDATAS) {
    try {
      const texto = await bajar(url, { intentos: 1, tiempoLimiteMs: 20000 });
      const arbol = parsearXML(texto);
      const entradas = buscarTodos(arbol, 'entry');
      const primera = entradas[0];
      salida.push({
        url,
        bytes: texto.length,
        entradas: entradas.length,
        cabeza: texto.slice(0, 400),
        nombresDeNodo: primera ? [...new Set(buscarTodos(primera, '*').map((n) => n.nombre))].slice(0, 40) : [],
        primeraEntrada: primera ? texto.slice(texto.indexOf('<entry'), texto.indexOf('<entry') + 2500) : null,
      });
    } catch (error) {
      salida.push({ url, error: String(error.message || error) });
    }
  }
  return salida;
}

export default async function handler(peticion, respuesta) {
  const url = new URL(peticion.url, 'https://local');
  const fuente = url.searchParams.get('fuente') || 'todas';
  const dias = Math.min(Number(url.searchParams.get('dias')) || 1, 5);
  const paginas = Math.min(Number(url.searchParams.get('paginas')) || 1, 4);

  const salida = { comprobado: new Date().toISOString(), fuente, dias, paginas };

  try {
    if (fuente === 'crudo') salida.crudo = await probarCrudo();
    if (fuente === 'boe' || fuente === 'todas') salida.boe = await probarBOE(dias);
    if (fuente === 'placsp' || fuente === 'todas') salida.placsp = await probarPLACSP(paginas, dias);
  } catch (error) {
    salida.error = String(error.message || error);
    respuesta.status(502);
  }

  respuesta.setHeader('Content-Type', 'application/json; charset=utf-8');
  respuesta.setHeader('Cache-Control', 'public, max-age=120');
  respuesta.end(JSON.stringify(salida, null, 1));
}
