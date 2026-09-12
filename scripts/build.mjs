/**
 * Ingesta: lee las fuentes oficiales y deja en data/ ficheros pequenos que el
 * movil pueda descargar sin sufrir.
 *
 *   node scripts/build.mjs                        ultimos 7 dias
 *   node scripts/build.mjs --dias=30              ultimos 30 dias
 *   node scripts/build.mjs --desde=2025-07-01 --solo=boe   relleno historico
 *   node scripts/build.mjs --demo                 datos de ejemplo, para la interfaz
 *
 * Reglas de la casa:
 *  - Ningun dato se inventa. Si una fuente falla, se anota en data/index.json
 *    y la app lo dice en pantalla.
 *  - Cada registro conserva el enlace a su documento oficial.
 *  - Los ficheros diarios se FUNDEN, no se reescriben: asi un relleno del BOE
 *    no se lleva por delante los contratos ya publicados de ese mismo dia.
 */

import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { ultimosDias, comoISO, restarDias } from './lib/red.mjs';
import { GLOSARIO } from './lib/texto.mjs';
import { SENALES, IMPORTE_ALTO } from './lib/senales.mjs';
import { sumarioDelDia, recorrerSumario } from './sources/boe.mjs';
import { leerContratos, contratoDesdeEntry } from './sources/placsp.mjs';
import { leerPresupuesto } from './sources/pge.mjs';
import { leerOposiciones, marcarAbiertas } from './sources/oposiciones.mjs';
import { parsearXML, buscarTodos } from './lib/xml.mjs';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

/** Contratos pequenos que no guardamos uno a uno (si cuentan en los totales). */
const MINIMO_DETALLE = 50_000;
/** Tope de contratos por dia. Los documentos del BOE nunca se recortan: son
 *  pocos y son justo lo que no sale en ningun sitio. */
const LIMITE_CONTRATOS_DIA = 300;
const DIAS_QUE_GUARDAMOS = 550;
/** Cuanto tiempo guardamos una convocatoria despues de cerrarse el plazo. */
const DIAS_DE_OPOSICIONES = 240;
/** Documentos completos que bajamos por ejecucion (un relleno largo se reparte). */
const TOPE_OPOSICIONES = 400;
/** Ventanas de los resumenes del indice. */
const VENTANA_PORTADA = 7;
const VENTANA_REPARTO = 30;
/** Cuantos sumarios del BOE pedimos a la vez en un relleno largo. */
const EN_PARALELO = 4;

/** Como se llama cada nivel de administracion en la pantalla. */
const NIVELES = {
  estado: 'Estado',
  autonomica: 'Comunidades autónomas',
  local: 'Ayuntamientos y diputaciones',
  universidad: 'Universidades',
  justicia: 'Administración de Justicia',
};

function argumento(nombre, porDefecto) {
  const encontrado = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return encontrado ? encontrado.split('=')[1] : porDefecto;
}
const hayBandera = (nombre) => process.argv.includes(`--${nombre}`);

/**
 * Orden de la lista: manda el dinero, y a igualdad de cifra suben las que
 * llevan una senal que merece una mirada.
 */
function relevancia(item) {
  const base = Number(item.importeAdjudicado ?? item.importe ?? 0) || 0;
  const avisos = (item.senales || []).filter((s) => SENALES[s]?.tono === 'aviso').length;
  return base + (avisos ? 25_000 : 0) + (item.categoria === 'personas' ? 10_000 : 0);
}

function comoItemContrato(c) {
  return {
    id: c.id,
    tipo: 'contrato',
    fecha: c.fecha,
    categoria: 'contratos',
    nivel: c.nivel,
    organismo: c.organismo,
    titulo: c.objeto,
    frase: c.frase,
    importe: c.importe,
    importeAdjudicado: c.importeAdjudicado,
    valorEstimado: c.valorEstimado,
    adjudicatario: c.adjudicatario,
    adjudicatarioId: c.adjudicatarioId,
    procedimiento: c.procedimiento,
    estado: c.estado,
    resultado: c.resultado,
    tipoContrato: c.tipo,
    ofertas: c.ofertas,
    expediente: c.expediente,
    plazoOfertas: c.plazoOfertas,
    cpv: c.cpv,
    esMenor: c.esMenor,
    senales: c.senales,
    jerga: c.jerga,
    url: c.url,
  };
}

function comoItemBOE(b) {
  return {
    id: b.id,
    tipo: 'boe',
    fecha: b.fecha,
    categoria: b.categoria,
    subtipo: b.subtipo,
    nivel: 'estado',
    organismo: b.organismo,
    titulo: b.titulo,
    frase: b.frase,
    importe: b.importe,
    seccion: b.seccion,
    epigrafe: b.epigrafe,
    senales: b.senales,
    jerga: b.jerga,
    url: b.url,
    urlPdf: b.urlPdf,
  };
}

/* --------------------------- Resumen de un dia --------------------------- */

const sumaEn = (mapa, clave, importe) => {
  if (!clave) return;
  const actual = mapa[clave] || { n: 0, importe: 0 };
  actual.n += 1;
  if (typeof importe === 'number') actual.importe += importe;
  mapa[clave] = actual;
};

const esLibreDesignacion = (i) => i.subtipo === 'libre-designacion' || i.subtipo === 'libre-designacion-resuelta';

/**
 * Cuentas de un dia, calculadas sobre TODOS sus registros (tambien los que no
 * guardamos uno a uno). Guardarlas permite reconstruir el indice sin volver a
 * descargar nada.
 */
function resumenDeDia(items) {
  const r = {
    contratos: 0, importeContratos: 0, importeAdjudicado: 0,
    sinCompetencia: 0, importeSinCompetencia: 0, menores: 0,
    documentos: 0, subvenciones: 0, importeSubvenciones: 0,
    nombramientos: 0, ceses: 0, libresDesignaciones: 0, empleo: 0, plazas: 0,
    porOrganismo: {}, porEmpresa: {}, porTipo: {}, porProcedimiento: {}, porNivel: {},
  };

  for (const i of items) {
    const importe = i.importeAdjudicado ?? i.importe ?? null;

    if (i.tipo === 'contrato') {
      r.contratos += 1;
      if (typeof i.importe === 'number') r.importeContratos += i.importe;
      if (typeof i.importeAdjudicado === 'number') r.importeAdjudicado += i.importeAdjudicado;
      if (i.esMenor) r.menores += 1;
      if ((i.senales || []).includes('sin-competencia')) {
        r.sinCompetencia += 1;
        if (typeof importe === 'number') r.importeSinCompetencia += importe;
      }
      sumaEn(r.porOrganismo, i.organismo, importe);
      if (i.adjudicatario) sumaEn(r.porEmpresa, i.adjudicatario, importe);
      sumaEn(r.porTipo, i.tipoContrato, importe);
      sumaEn(r.porProcedimiento, i.procedimiento, importe);
      sumaEn(r.porNivel, NIVELES[i.nivel] || null, importe);
      continue;
    }

    r.documentos += 1;
    if (i.categoria === 'subvenciones') {
      r.subvenciones += 1;
      if (typeof i.importe === 'number') r.importeSubvenciones += i.importe;
    }
    if (i.subtipo === 'nombramiento') r.nombramientos += 1;
    if (i.subtipo === 'cese') r.ceses += 1;
    if (esLibreDesignacion(i)) r.libresDesignaciones += 1;
    if (i.subtipo === 'empleo') {
      r.empleo += 1;
      const plazas = (i.titulo || '').match(/(\d{1,5})\s+plazas?/i);
      if (plazas) r.plazas += Number(plazas[1]);
    }
    if (i.organismo && typeof i.importe === 'number' && i.categoria !== 'personas') {
      sumaEn(r.porOrganismo, i.organismo, i.importe);
    }
  }
  return r;
}

/** Suma los resumenes de varios dias en uno. */
function acumular(resumenes) {
  const total = resumenDeDia([]);
  for (const r of resumenes) {
    for (const [clave, valor] of Object.entries(r)) {
      if (typeof valor === 'number') total[clave] += valor;
      else for (const [k, v] of Object.entries(valor || {})) {
        const actual = total[clave][k] || { n: 0, importe: 0 };
        total[clave][k] = { n: actual.n + v.n, importe: actual.importe + v.importe };
      }
    }
  }
  return total;
}

const ordenar = (mapa, tope) =>
  Object.entries(mapa || {})
    .map(([clave, v]) => ({ clave, n: v.n, importe: Math.round(v.importe) }))
    .sort((a, b) => b.importe - a.importe || b.n - a.n)
    .slice(0, tope);

/* ------------------------------- Ficheros -------------------------------- */

async function diasEnDisco(salida) {
  if (!existsSync(path.join(salida, 'dias'))) return [];
  const ficheros = await readdir(path.join(salida, 'dias'));
  return ficheros.filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.replace('.json', '')).sort().reverse();
}

const leerDia = async (salida, fecha) =>
  JSON.parse(await readFile(path.join(salida, 'dias', `${fecha}.json`), 'utf8'));

/* --------------------------------- Demo ---------------------------------- */

async function fuentesDemo() {
  const boeCrudo = JSON.parse(await readFile(path.join(RAIZ, 'scripts/fixtures/boe-sumario.json'), 'utf8'));
  const hoy = comoISO(new Date());
  const boe = recorrerSumario(boeCrudo, { fecha: hoy, codigo: '', seccionNombre: null }, []);
  const atom = parsearXML(await readFile(path.join(RAIZ, 'scripts/fixtures/placsp.atom'), 'utf8'));
  const contratos = buscarTodos(atom, 'entry')
    .map((e) => contratoDesdeEntry(e, {}))
    .filter(Boolean)
    .map((c) => ({ ...c, fecha: hoy }));
  return { boe, contratos };
}

/* --------------------------------- Main ---------------------------------- */

async function main() {
  const dias = Number(argumento('dias', '7'));
  const desde = argumento('desde', null);
  const solo = argumento('solo', null);
  const salida = path.resolve(RAIZ, argumento('salida', 'data'));
  const demo = hayBandera('demo');
  const generado = new Date().toISOString();

  const fechasBOE = desde ? rangoDeFechas(desde) : ultimosDias(dias);
  const fuentes = [];
  const avisos = [];
  if (demo) avisos.push('MODO DEMO: los datos son de ejemplo, no son reales.');

  console.log(`Ingesta ${comoISO(fechasBOE[fechasBOE.length - 1])} → ${comoISO(fechasBOE[0])}${demo ? ' (DEMO)' : ''}${solo ? ` (solo ${solo})` : ''}`);

  let itemsBOE = [];
  let contratos = [];
  let presupuesto = null;

  if (demo) {
    const d = await fuentesDemo();
    itemsBOE = d.boe;
    contratos = d.contratos;
    fuentes.push({ clave: 'demo', nombre: 'Datos de ejemplo', estado: 'ok', registros: itemsBOE.length + contratos.length });
  } else {
    if (solo !== 'placsp') {
      const { items, diasLeidos, errores } = await leerBOE(fechasBOE);
      itemsBOE = items;
      fuentes.push({
        clave: 'boe',
        nombre: 'Boletín Oficial del Estado',
        estado: items.length > 0 ? 'ok' : 'error',
        registros: items.length,
        dias: diasLeidos,
        mensaje: errores.length ? `${errores.length} días con error · ${errores.slice(0, 2).join(' · ')}` : null,
        url: 'https://www.boe.es/datosabiertos/',
      });
    }

    if (solo !== 'boe') {
      try {
        const resultado = await leerContratos(dias);
        contratos = resultado.contratos;
        fuentes.push({
          clave: 'placsp',
          nombre: 'Plataforma de Contratación del Sector Público',
          estado: 'ok',
          registros: contratos.length,
          mensaje: resultado.errores.length ? resultado.errores.join(' · ') : null,
          url: 'https://contrataciondelsectorpublico.gob.es/wps/portal/DatosAbiertos',
        });
      } catch (error) {
        fuentes.push({
          clave: 'placsp',
          nombre: 'Plataforma de Contratación del Sector Público',
          estado: 'error',
          registros: 0,
          mensaje: String(error.message || error),
          url: 'https://contrataciondelsectorpublico.gob.es/wps/portal/DatosAbiertos',
        });
        console.warn(`  ⚠ PLACSP: ${error.message || error}`);
      }

      try {
        presupuesto = await leerPresupuesto();
      } catch (error) {
        presupuesto = { disponible: false, motivo: String(error.message || error) };
      }
      fuentes.push({
        clave: 'pge',
        nombre: 'Presupuestos Generales del Estado',
        estado: presupuesto.disponible ? 'ok' : 'no-disponible',
        registros: presupuesto.disponible ? presupuesto.partidas.length : 0,
        mensaje: presupuesto.disponible ? null : presupuesto.motivo,
        url: 'https://www.sepg.pap.hacienda.gob.es/sitios/sepg/es-ES/Presupuestos/Paginas/Presupuestos.aspx',
      });
    }
  }

  if (!demo && fuentes.length && fuentes.every((f) => f.estado === 'error')) {
    console.error('\nNinguna fuente respondió. No se toca data/.');
    process.exit(1);
  }

  // --- Fundir con lo que ya hay, dia a dia -------------------------------
  await mkdir(path.join(salida, 'dias'), { recursive: true });

  const nuevosPorDia = new Map();
  const apuntar = (item) => {
    if (!item.fecha) return;
    if (!nuevosPorDia.has(item.fecha)) nuevosPorDia.set(item.fecha, []);
    nuevosPorDia.get(item.fecha).push(item);
  };
  for (const b of itemsBOE) apuntar(comoItemBOE(b));
  for (const c of contratos) apuntar(comoItemContrato(c));

  for (const [fecha, nuevos] of nuevosPorDia) {
    const previo = existsSync(path.join(salida, 'dias', `${fecha}.json`))
      ? await leerDia(salida, fecha)
      : null;

    // Los que ya estaban y no vuelven a venir se conservan; los repetidos se
    // actualizan con la version nueva (un contrato puede pasar a adjudicado).
    const porId = new Map((previo?.items || []).map((i) => [i.id, i]));
    const tocados = new Set();
    for (const item of nuevos) {
      porId.set(item.id, item);
      tocados.add(item.tipo);
    }
    const todos = [...porId.values()];

    // Los contratos pequenos sin nada que senalar cuentan, pero no se listan.
    const relevante = (i) => i.tipo !== 'contrato' ||
      (typeof (i.importeAdjudicado ?? i.importe) === 'number' && (i.importeAdjudicado ?? i.importe) >= MINIMO_DETALLE) ||
      (i.senales || []).some((s) => SENALES[s]?.tono === 'aviso');

    const listables = todos.filter(relevante).sort((a, b) => relevancia(b) - relevancia(a));
    const documentos = listables.filter((i) => i.tipo === 'boe');
    const contratosDia = listables.filter((i) => i.tipo === 'contrato');
    const guardados = [...documentos, ...contratosDia.slice(0, LIMITE_CONTRATOS_DIA)]
      .sort((a, b) => relevancia(b) - relevancia(a));

    const enGuardados = new Set(guardados);
    const fuera = todos.filter((i) => !enGuardados.has(i));

    // Los contratos que no se listan siguen contando: guardamos su agregado
    // aparte para poder reconstruir el total sin tenerlos uno a uno. Si esta
    // ingesta no ha traido contratos (un relleno del BOE, por ejemplo), se
    // conserva el agregado anterior en vez de perderlo.
    const huboContratos = tocados.has('contrato');
    const resumenFuera = huboContratos
      ? resumenDeDia(fuera)
      : acumular([resumenDeDia(fuera), previo?.resumenFuera || resumenDeDia([])]);

    await writeFile(path.join(salida, 'dias', `${fecha}.json`), JSON.stringify({
      fecha,
      generado,
      resumen: acumular([resumenDeDia(guardados), resumenFuera]),
      resumenFuera,
      items: guardados,
      omitidos: resumenFuera.contratos,
      importeOmitido: Math.round(resumenFuera.importeAdjudicado || resumenFuera.importeContratos),
    }));
  }

  // --- Indice: se reconstruye a partir de lo que hay en disco -------------
  const fechas = await diasEnDisco(salida);
  const resumenes = new Map();
  for (const fecha of fechas) {
    const dia = await leerDia(salida, fecha);
    resumenes.set(fecha, dia.resumen || resumenDeDia(dia.items || []));
  }

  const ultimas = (n) => fechas.slice(0, n).map((f) => resumenes.get(f));
  const portada = acumular(ultimas(VENTANA_PORTADA));
  const reparto = acumular(ultimas(VENTANA_REPARTO));

  const porMes = {};
  for (const [fecha, r] of resumenes) {
    const mes = fecha.slice(0, 7);
    const actual = porMes[mes] || { mes, documentos: 0, libresDesignaciones: 0, nombramientos: 0, ceses: 0, plazas: 0, subvenciones: 0, contratos: 0, importeContratos: 0 };
    actual.documentos += r.documentos;
    actual.libresDesignaciones += r.libresDesignaciones;
    actual.nombramientos += r.nombramientos;
    actual.ceses += r.ceses;
    actual.plazas += r.plazas;
    actual.subvenciones += r.subvenciones;
    actual.contratos += r.contratos;
    actual.importeContratos += Math.round(r.importeAdjudicado || r.importeContratos);
    porMes[mes] = actual;
  }

  const indice = {
    version: 2,
    generado,
    ventana: { desde: fechas[Math.min(VENTANA_PORTADA, fechas.length) - 1] || null, hasta: fechas[0] || null, dias: Math.min(VENTANA_PORTADA, fechas.length) },
    cobertura: { desde: fechas[fechas.length - 1] || null, hasta: fechas[0] || null, dias: fechas.length },
    demo,
    avisos,
    fuentes,
    totales: {
      contratos: portada.contratos,
      importeContratos: Math.round(portada.importeContratos),
      importeAdjudicado: Math.round(portada.importeAdjudicado),
      sinCompetencia: portada.sinCompetencia,
      importeSinCompetencia: Math.round(portada.importeSinCompetencia),
      menores: portada.menores,
      documentosBOE: portada.documentos,
      subvenciones: portada.subvenciones,
      importeSubvenciones: Math.round(portada.importeSubvenciones),
      nombramientos: portada.nombramientos,
      ceses: portada.ceses,
      libresDesignaciones: portada.libresDesignaciones,
      plazas: portada.plazas,
    },
    dias: fechas.slice(0, 120).map((fecha) => {
      const r = resumenes.get(fecha);
      return {
        fecha,
        contratos: r.contratos,
        personas: r.nombramientos + r.ceses + r.libresDesignaciones + r.empleo,
        importe: Math.round(r.importeAdjudicado || r.importeContratos),
      };
    }),
    reparto: {
      dias: Math.min(VENTANA_REPARTO, fechas.length),
      porOrganismo: ordenar(reparto.porOrganismo, 40),
      empresas: ordenar(reparto.porEmpresa, 30),
      porTipo: ordenar(reparto.porTipo, 10),
      porProcedimiento: ordenar(reparto.porProcedimiento, 12),
      porNivel: ordenar(reparto.porNivel, 6),
    },
    historico: Object.values(porMes).sort((a, b) => (a.mes < b.mes ? 1 : -1)),
    presupuesto: presupuesto || { disponible: false, motivo: 'No se ha consultado en esta ingesta.' },
    umbrales: { importeAlto: IMPORTE_ALTO, minimoDetalle: MINIMO_DETALLE },
  };

  // --- Oposiciones: lo que hay dentro del documento, no solo el titular ---
  const oposiciones = await actualizarOposiciones(salida, itemsBOE, demo, fechas[0]);
  indice.oposiciones = {
    abiertas: oposiciones.filter((o) => o.abierta).length,
    plazasAbiertas: oposiciones.filter((o) => o.abierta).reduce((t, o) => t + (o.plazas || 0), 0),
    total: oposiciones.length,
  };

  await writeFile(path.join(salida, 'index.json'), JSON.stringify(indice, null, 1));
  await writeFile(path.join(salida, 'glosario.json'), JSON.stringify(GLOSARIO, null, 1));
  await writeFile(path.join(salida, 'senales.json'), JSON.stringify(SENALES, null, 1));

  for (const viejo of fechas.slice(DIAS_QUE_GUARDAMOS)) {
    await rm(path.join(salida, 'dias', `${viejo}.json`));
  }

  console.log('\nResumen:');
  console.log(`  Días con datos:    ${fechas.length} (${indice.cobertura.desde} → ${indice.cobertura.hasta})`);
  console.log(`  Contratos (7 d):   ${portada.contratos} · ${(portada.importeContratos / 1e6).toFixed(1)} M€ presupuestados`);
  console.log(`  Documentos BOE:    ${portada.documentos}`);
  console.log(`  Libre designación: ${portada.libresDesignaciones}`);
  for (const f of fuentes) console.log(`  Fuente ${f.clave}: ${f.estado}${f.mensaje ? ` — ${f.mensaje}` : ''}`);
}

/**
 * Funde las convocatorias ya conocidas con las nuevas y recalcula cuales
 * siguen abiertas. Solo se baja el texto de las que no conociamos.
 */
async function actualizarOposiciones(salida, itemsBOE, demo, ultimoDia) {
  const fichero = path.join(salida, 'oposiciones.json');
  const previas = existsSync(fichero)
    ? (JSON.parse(await readFile(fichero, 'utf8')).convocatorias || [])
    : [];

  let convocatorias = previas;
  if (!demo) {
    const candidatas = itemsBOE.slice(0, TOPE_OPOSICIONES * 4);
    const { nuevas } = await leerOposiciones(candidatas, previas);
    const porId = new Map(previas.map((c) => [c.id, c]));
    for (const nueva of nuevas.slice(0, TOPE_OPOSICIONES)) porId.set(nueva.id, nueva);
    convocatorias = [...porId.values()];
  } else if (previas.length === 0) {
    const ejemplo = itemsBOE.find((i) => i.subtipo === 'empleo');
    if (ejemplo) {
      convocatorias = [{
        id: ejemplo.id, tipo: 'oposicion', fecha: ejemplo.fecha, organismo: ejemplo.organismo,
        titulo: ejemplo.titulo, frase: 'EJEMPLO: el Ministerio de Justicia convoca 250 plazas del subgrupo C1.',
        plazas: 250, grupo: 'C1', sistema: 'Oposición', acceso: ['Acceso libre'],
        titulacion: 'Estar en posesión del título de Bachiller o equivalente.',
        tasa: '30,49', plazo: { dias: 20, tipo: 'hábiles' },
        comoApuntarse: 'Solicitud por internet (modelo 790).',
        limite: '2026-12-31', url: ejemplo.url, urlPdf: ejemplo.urlPdf,
      }];
    }
  }

  const corte = restarDias(ultimoDia || comoISO(new Date()), DIAS_DE_OPOSICIONES);
  const vivas = marcarAbiertas(convocatorias.filter((c) => c.fecha >= corte))
    .sort((a, b) => {
      if (a.abierta !== b.abierta) return a.abierta ? -1 : 1;
      return (a.limite || '9999') < (b.limite || '9999') ? -1 : 1;
    });

  await writeFile(fichero, JSON.stringify({ generado: new Date().toISOString(), convocatorias: vivas }, null, 1));
  console.log(`  Oposiciones: ${vivas.filter((c) => c.abierta).length} abiertas de ${vivas.length} guardadas`);
  return vivas;
}

/** Todas las fechas desde una dada hasta hoy, de la mas reciente a la mas antigua. */
function rangoDeFechas(desdeISO) {
  const fechas = [];
  const fin = new Date(`${desdeISO}T00:00:00Z`);
  const hoy = new Date();
  let actual = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()));
  while (actual >= fin) {
    fechas.push(new Date(actual));
    actual = new Date(actual.getTime() - 86400000);
  }
  return fechas;
}

/** Lee los sumarios en tandas: un relleno de un año son cientos de peticiones. */
async function leerBOE(fechas) {
  const items = [];
  const errores = [];
  let diasLeidos = 0;

  for (let i = 0; i < fechas.length; i += EN_PARALELO) {
    const tanda = fechas.slice(i, i + EN_PARALELO);
    const resultados = await Promise.all(tanda.map(async (fecha) => {
      try {
        const { items: delDia } = await sumarioDelDia(fecha, { log() {} });
        return { ok: true, fecha, delDia };
      } catch (error) {
        return { ok: false, fecha, mensaje: String(error.message || error) };
      }
    }));
    for (const r of resultados) {
      if (r.ok) { items.push(...r.delDia); diasLeidos += 1; }
      else errores.push(r.mensaje);
    }
    if (fechas.length > 30 && (i + EN_PARALELO) % 100 < EN_PARALELO) {
      console.log(`  BOE: ${i + tanda.length}/${fechas.length} días, ${items.length} documentos`);
    }
  }
  return { items, diasLeidos, errores };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
