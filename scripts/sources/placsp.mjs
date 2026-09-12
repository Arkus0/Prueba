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

import { bajar, restarDias } from '../lib/red.mjs';
import { parsearXML, buscar, buscarTodos, texto, textoDe, hijos } from '../lib/xml.mjs';
import { numeroCodice, nombrePropio, limpiarTitulo, jergaEn, sujetoYVerbo, recortar } from '../lib/texto.mjs';
import { senalesDeContrato } from '../lib/senales.mjs';

const BASE = 'https://contrataciondelsectorpublico.gob.es/sindicacion';

export const FEEDS = [
  {
    clave: 'licitaciones',
    nombre: 'Licitaciones de los perfiles del contratante',
    url: `${BASE}/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom`,
    esMenor: false,
    obligatorio: true,
  },
  {
    clave: 'agregadas',
    nombre: 'Plataformas autonómicas agregadas',
    url: `${BASE}/sindicacion_1044/PlataformasAgregadasSinMenores.atom`,
    esMenor: false,
    obligatorio: false,
  },
  {
    clave: 'menores',
    nombre: 'Contratos menores',
    url: `${BASE}/sindicacion_1143/contratosMenoresPerfilesContratantes.atom`,
    esMenor: true,
    obligatorio: false,
  },
];

/**
 * Quién contrata: Estado, comunidad autónoma o ayuntamiento. Se deduce del
 * código DIR3 del organismo (E/A/L/U/J) y, si no hay, del tipo de poder
 * adjudicador. Si no lo sabemos con certeza, se queda en null.
 */
const NIVEL_POR_DIR3 = { E: 'estado', A: 'autonomica', L: 'local', U: 'universidad', J: 'justicia', I: 'estado' };
const NIVEL_POR_TIPO = { 1: 'estado', 2: 'autonomica', 3: 'local' };

export function nivelAdministracion(parte) {
  if (!parte) return null;
  for (const id of buscarTodos(parte, 'ID')) {
    if ((id.attrs.schemeName || '').toUpperCase() === 'DIR3') {
      const inicial = texto(id).trim().charAt(0).toUpperCase();
      if (NIVEL_POR_DIR3[inicial]) return NIVEL_POR_DIR3[inicial];
    }
  }
  const tipo = textoDe(parte, 'ContractingPartyTypeCode');
  return NIVEL_POR_TIPO[Number(tipo)] || null;
}

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

/**
 * Ningun contrato publico espanol vale diez mil millones de euros. Si sale una
 * cifra asi es que hemos leido mal el numero, y preferimos no dar ninguna.
 */
const TECHO_RAZONABLE = 10_000_000_000;

function primerNumero(nodo, ...nombres) {
  for (const nombre of nombres) {
    const valor = textoDe(nodo, nombre);
    const numero = numeroCodice(valor);
    if (numero === null) continue;
    if (numero > TECHO_RAZONABLE || numero < 0) continue;
    return numero;
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
    nivel: nivelAdministracion(parte),
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
  const objeto = c.objeto ? recortar(c.objeto.charAt(0).toLowerCase() + c.objeto.slice(1), 110) : null;
  if (!c.organismo || !objeto) return null;

  const verbo = c.adjudicatario
    ? `contrata a ${c.adjudicatario} para ${objeto}`
    : c.resultado === 'Desierta'
      ? `no encuentra a nadie para ${objeto}`
      : `busca quien se encargue de ${objeto}`;

  const frase = sujetoYVerbo(c.organismo, verbo);
  if (!frase) return null;
  return /[.…!?]$/.test(frase) ? frase : `${frase}.`;
}

/**
 * Descarga un feed encadenado.
 *
 * La ventana se mide contra la entrada mas reciente del propio feed, no contra
 * el reloj: la Plataforma publica con unos dias de retraso y medir contra hoy
 * dejaba fuera absolutamente todo.
 */
export async function leerFeed(feed, dias, registro = console, maxPaginas = 10, tope = 4000) {
  const contratos = [];
  let url = feed.url;
  let pagina = 0;
  let masReciente = null;

  while (url && pagina < maxPaginas && contratos.length < tope) {
    const xml = await bajar(url, { intentos: feed.obligatorio ? 3 : 1, tiempoLimiteMs: 60000 });
    const arbol = parsearXML(xml);
    const entradas = buscarTodos(arbol, 'entry');
    if (entradas.length === 0) break;

    let masAntiguoEnPagina = null;
    for (const entrada of entradas) {
      const contrato = contratoDesdeEntry(entrada, { esMenor: feed.esMenor });
      if (!contrato || !contrato.fecha) continue;
      if (!masReciente || contrato.fecha > masReciente) masReciente = contrato.fecha;
      if (!masAntiguoEnPagina || contrato.fecha < masAntiguoEnPagina) masAntiguoEnPagina = contrato.fecha;
      contratos.push(contrato);
    }

    pagina += 1;
    registro.log?.(`  PLACSP ${feed.clave}: página ${pagina}, ${contratos.length} entradas leídas`);

    const limite = masReciente ? restarDias(masReciente, dias - 1) : null;
    if (limite && masAntiguoEnPagina && masAntiguoEnPagina < limite) break;

    const siguiente = buscarTodos(arbol, 'link').find((l) => l.attrs.rel === 'next');
    url = siguiente ? siguiente.attrs.href : null;
  }

  const limite = masReciente ? restarDias(masReciente, dias - 1) : null;
  return limite ? contratos.filter((c) => c.fecha >= limite) : contratos;
}

/** Lee todos los feeds configurados. Los opcionales no rompen la ingesta. */
export async function leerContratos(dias, registro = console) {
  const contratos = [];
  const errores = [];

  for (const feed of FEEDS) {
    try {
      const encontrados = await leerFeed(feed, dias, registro);
      registro.log?.(`  PLACSP ${feed.clave}: ${encontrados.length} contratos en ventana`);
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
