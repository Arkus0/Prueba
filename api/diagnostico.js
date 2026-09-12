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

async function probarPLACSP(paginas) {
  const desde = comoISO(ultimosDias(3)[2]);
  const contratos = await leerFeed(FEEDS[0], desde, mudo, paginas);
  const campo = (nombre) => contratos.filter((c) => c[nombre] !== null && c[nombre] !== undefined).length;
  return {
    estado: contratos.length ? 'ok' : 'sin-datos',
    registros: contratos.length,
    camposLeidos: {
      organismo: campo('organismo'),
      objeto: campo('objeto'),
      importe: campo('importe'),
      procedimiento: campo('procedimiento'),
      adjudicatario: campo('adjudicatario'),
      estado: campo('estado'),
    },
    sinCompetencia: contratos.filter((c) => c.senales.includes('sin-competencia')).length,
    muestra: contratos.slice(0, 5),
  };
}

export default async function handler(peticion, respuesta) {
  const url = new URL(peticion.url, 'https://local');
  const fuente = url.searchParams.get('fuente') || 'todas';
  const dias = Math.min(Number(url.searchParams.get('dias')) || 1, 5);
  const paginas = Math.min(Number(url.searchParams.get('paginas')) || 1, 4);

  const salida = { comprobado: new Date().toISOString(), fuente, dias, paginas };

  try {
    if (fuente === 'boe' || fuente === 'todas') salida.boe = await probarBOE(dias);
    if (fuente === 'placsp' || fuente === 'todas') salida.placsp = await probarPLACSP(paginas);
  } catch (error) {
    salida.error = String(error.message || error);
    respuesta.status(502);
  }

  respuesta.setHeader('Content-Type', 'application/json; charset=utf-8');
  respuesta.setHeader('Cache-Control', 'public, max-age=120');
  respuesta.end(JSON.stringify(salida, null, 1));
}
