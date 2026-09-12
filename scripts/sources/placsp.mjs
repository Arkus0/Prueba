/**
 * Plataforma de Contratacion del Sector Publico (PLACSP), datos abiertos.
 *
 * Fuente: fichero Atom diario con las licitaciones publicadas. Cada <entry>
 * lleva dentro un bloque XML en formato CODICE con los datos estructurados,
 * y un <summary> en castellano que usamos como red de seguridad cuando el
 * bloque estructurado no trae algun campo.
 *
 *   .../sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom
 *
 * Los ficheros se encadenan con <link rel="next">, 500 entradas cada uno.
 */

import { bajar } from '../lib/red.mjs';
import { parsearXML, buscar, buscarTodos, texto, textoDe, hijos } from '../lib/xml.mjs';
import { numeroCodice, nombrePropio, limpiarTitulo, jergaEn, conArticuloMayus } from '../lib/texto.mjs';
import { senalesDeContrato } from '../lib/senales.mjs';

const BASE = 'https://contrataciondelsectorpublico.gob.es/sindicacion';

export const FEEDS = [
  {
    clave: 'licitaciones',
    url: `${BASE}/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom`,
    esMenor: false,
    obligatorio: true,
  },
  {
    clave: 'menores',
    url: `${BASE}/sindicacion_1143/contratosMenoresPerfilesContratantes.atom`,
    esMenor: true,
    obligatorio: false,
  },
];

/** Codigos CODICE que conocemos con seguridad. Lo que no, se queda en null. */
const TIPOS = { 1: 'Suministros', 2: 'Servicios', 3: 'Obras', 21: 'Gestión de servicios públicos', 31: 'Concesión de servicios', 32: 'Concesión de obras' };

const PROCEDIMIENTOS = {
  1: 'Concurso abierto',
  2: 'Restringido',
  3: 'Negociado con publicidad',
  4: 'Negociado sin publicidad',
  5: 'Diálogo competitivo',
  6: 'Contrato menor',
  7: 'Derivado de acuerdo marco',
  8: 'Concurso de proyectos',
  9: 'Normas internas',
  12: 'Abierto simplificado',
  13: 'Sistema dinámico de adquisición',
};

const ESTADOS = {
  PRE: 'Aviso previo',
  PUB: 'Abierta a ofertas',
  EV: 'En evaluación',
  ADJ: 'Adjudicada',
  RES: 'Resuelta',
  ANUL: 'Anulada',
};

const RESULTADOS = { 1: 'Adjudicada', 2: 'Adjudicada', 3: 'Desierta', 4: 'Renuncia', 5: 'Desistimiento', 8: 'Adjudicada (provisional)' };

/** Pares "clave: valor" del resumen en castellano que publica la Plataforma. */
export function leerResumen(resumen) {
  const datos = {};
  if (!resumen) return datos;
  for (const trozo of resumen.split(/;\s*/)) {
    const corte = trozo.indexOf(':');
    if (corte === -1) continue;
    const clave = trozo.slice(0, corte).trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    datos[clave] = trozo.slice(corte + 1).trim();
  }
  return datos;
}

function primerNumero(nodo, ...nombres) {
  for (const nombre of nombres) {
    const valor = textoDe(nodo, nombre);
    const numero = numeroCodice(valor);
    if (numero !== null) return numero;
  }
  return null;
}

/** Convierte una <entry> del Atom en un contrato normalizado. */
export function contratoDesdeEntry(entry, opciones = {}) {
  const estado = buscar(entry, 'ContractFolderStatus') || entry;
  const resumen = leerResumen(textoDe(entry, 'summary'));

  const expediente = textoDe(estado, 'ContractFolderID') || resumen['id licitacion'] || null;
  const id = textoDe(entry, 'id') || expediente;
  if (!id) return null;

  const parte = buscar(estado, 'LocatedContractingParty');
  const organismoBruto = (parte && textoDe(parte, 'Name')) || resumen['organo de contratacion'] || null;

  const proyecto = buscar(estado, 'ProcurementProject') || buscar(estado, 'ProcurationProject');
  const objeto = (proyecto && textoDe(proyecto, 'Name')) || limpiarTitulo(textoDe(entry, 'title')) || null;

  const presupuesto = proyecto ? buscar(proyecto, 'BudgetAmount') : null;
  const importe = presupuesto
    ? primerNumero(presupuesto, 'TaxExclusiveAmount', 'TotalAmount')
    : numeroCodice((resumen.importe || '').replace(/\s*EUR.*/i, ''));
  const importeConIva = presupuesto ? primerNumero(presupuesto, 'TotalAmount') : null;
  const valorEstimado = presupuesto ? primerNumero(presupuesto, 'EstimatedOverallContractAmount') : null;

  const proceso = buscar(estado, 'TenderingProcess');
  const procedimientoCodigo = proceso ? textoDe(proceso, 'ProcedureCode') : null;
  const plazo = proceso ? buscar(proceso, 'TenderSubmissionDeadlinePeriod') : null;

  const resultado = buscar(estado, 'TenderResult');
  const ganador = resultado ? buscar(resultado, 'WinningParty') : null;
  const adjudicado = resultado ? buscar(resultado, 'AwardedTenderedProject') : null;
  const resultadoCodigo = resultado ? textoDe(resultado, 'ResultCode') : null;

  const estadoCodigo = textoDe(estado, 'ContractFolderStatusCode');
  const tipoCodigo = proyecto ? textoDe(proyecto, 'TypeCode') : null;
  const cpv = proyecto
    ? buscarTodos(proyecto, 'ItemClassificationCode').map((n) => texto(n)).filter(Boolean).slice(0, 4)
    : [];

  const contrato = {
    id,
    fuente: 'PLACSP',
    expediente,
    fecha: (textoDe(entry, 'updated') || '').slice(0, 10) || null,
    organismo: organismoBruto ? nombrePropio(organismoBruto) : null,
    objeto: objeto ? limpiarTitulo(objeto) : null,
    tipo: TIPOS[Number(tipoCodigo)] || null,
    cpv,
    procedimiento: PROCEDIMIENTOS[Number(procedimientoCodigo)] || null,
    procedimientoCodigo: procedimientoCodigo || null,
    estado: ESTADOS[estadoCodigo] || resumen.estado || null,
    estadoCodigo: estadoCodigo || null,
    plazoOfertas: plazo ? textoDe(plazo, 'EndDate') : null,
    importe,
    importeConIva,
    valorEstimado,
    adjudicatario: ganador ? nombrePropio(textoDe(ganador, 'Name') || '') || null : null,
    adjudicatarioId: ganador ? textoDe(ganador, 'ID') : null,
    importeAdjudicado: adjudicado ? primerNumero(adjudicado, 'TaxExclusiveAmount', 'PayableAmount') : null,
    ofertas: resultado ? Number(textoDe(resultado, 'ReceivedTenderQuantity')) || null : null,
    resultado: RESULTADOS[Number(resultadoCodigo)] || null,
    resultadoCodigo: resultadoCodigo || null,
    fechaAdjudicacion: resultado ? textoDe(resultado, 'AwardDate') : null,
    esMenor: Boolean(opciones.esMenor) || String(procedimientoCodigo) === '6',
    url: enlaceDeEntry(entry),
  };

  contrato.senales = senalesDeContrato(contrato);
  contrato.jerga = jergaEn(`${contrato.objeto || ''} ${contrato.procedimiento || ''}`);
  contrato.frase = fraseDeContrato(contrato);
  return contrato;
}

function enlaceDeEntry(entry) {
  for (const enlace of hijos(entry, 'link')) {
    const rel = enlace.attrs.rel;
    if (!rel || rel === 'alternate') return enlace.attrs.href || null;
  }
  const id = textoDe(entry, 'id');
  return id && id.startsWith('http') ? id : null;
}

/** Una linea en castellano llano. El objeto oficial sigue visible en la ficha. */
export function fraseDeContrato(c) {
  const quien = conArticuloMayus(c.organismo);
  const objeto = c.objeto ? c.objeto.charAt(0).toLowerCase() + c.objeto.slice(1) : null;

  if (c.adjudicatario && objeto && quien) {
    return `${quien} contrata a ${c.adjudicatario} para ${objeto}.`;
  }
  if (c.resultado === 'Desierta' && quien && objeto) {
    return `${quien} no encontró a nadie para ${objeto}.`;
  }
  if (quien && objeto) {
    return `${quien} busca quien se encargue de ${objeto}.`;
  }
  return null;
}

/** Descarga un feed encadenado y devuelve los contratos dentro de la ventana. */
export async function leerFeed(feed, desdeISO, registro = console, maxPaginas = 12) {
  const contratos = [];
  let url = feed.url;
  let pagina = 0;
  let agotado = false;

  while (url && pagina < maxPaginas && !agotado) {
    const xml = await bajar(url, { intentos: feed.obligatorio ? 3 : 1 });
    const arbol = parsearXML(xml);
    const entradas = buscarTodos(arbol, 'entry');
    if (entradas.length === 0) break;

    let masAntiguoEnPagina = null;
    for (const entrada of entradas) {
      const contrato = contratoDesdeEntry(entrada, { esMenor: feed.esMenor });
      if (!contrato || !contrato.fecha) continue;
      if (!masAntiguoEnPagina || contrato.fecha < masAntiguoEnPagina) masAntiguoEnPagina = contrato.fecha;
      if (contrato.fecha >= desdeISO) contratos.push(contrato);
    }

    // Si toda la pagina ya es anterior a la ventana, no seguimos hacia atras.
    if (masAntiguoEnPagina && masAntiguoEnPagina < desdeISO) agotado = true;

    const siguiente = buscarTodos(arbol, 'link').find((l) => l.attrs.rel === 'next');
    url = siguiente ? siguiente.attrs.href : null;
    pagina += 1;
    registro.log?.(`  PLACSP ${feed.clave}: página ${pagina}, ${contratos.length} contratos en ventana`);
  }

  return contratos;
}

/** Lee todos los feeds configurados. Los opcionales no rompen la ingesta. */
export async function leerContratos(desdeISO, registro = console) {
  const contratos = [];
  const errores = [];

  for (const feed of FEEDS) {
    try {
      const encontrados = await leerFeed(feed, desdeISO, registro);
      contratos.push(...encontrados);
    } catch (error) {
      const mensaje = `PLACSP/${feed.clave}: ${error.message || error}`;
      errores.push(mensaje);
      registro.warn?.(`  ⚠ ${mensaje}`);
      if (feed.obligatorio) throw new Error(mensaje);
    }
  }

  const vistos = new Set();
  const unicos = contratos.filter((c) => {
    const clave = c.expediente || c.id;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });

  return { contratos: unicos, errores };
}
