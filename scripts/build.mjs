/**
 * Ingesta diaria: lee las fuentes oficiales y deja en data/ ficheros pequenos
 * que el movil pueda descargar sin sufrir.
 *
 *   node scripts/build.mjs [--dias=7] [--salida=data] [--demo]
 *
 * Reglas de la casa:
 *  - Ningun dato se inventa. Si una fuente falla, se anota en data/index.json
 *    y la app lo dice en pantalla.
 *  - Cada registro conserva el enlace a su documento oficial.
 */

import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { ultimosDias, comoISO } from './lib/red.mjs';
import { GLOSARIO } from './lib/texto.mjs';
import { SENALES, IMPORTE_ALTO } from './lib/senales.mjs';
import { sumarioDelDia, recorrerSumario } from './sources/boe.mjs';
import { leerContratos, contratoDesdeEntry } from './sources/placsp.mjs';
import { leerPresupuesto } from './sources/pge.mjs';
import { parsearXML, buscarTodos } from './lib/xml.mjs';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

/** Contratos pequenos que no guardamos uno a uno (si contamos su importe). */
const MINIMO_DETALLE = 50_000;
const LIMITE_DIARIO = 400;
const DIAS_QUE_GUARDAMOS = 120;

function argumento(nombre, porDefecto) {
  const encontrado = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return encontrado ? encontrado.split('=')[1] : porDefecto;
}
const hayBandera = (nombre) => process.argv.includes(`--${nombre}`);

/** Lo interesante no es solo lo caro: las senales tambien suben en la lista. */
function relevancia(item) {
  const base = Number(item.importeAdjudicado ?? item.importe ?? 0) || 0;
  let extra = 0;
  for (const senal of item.senales || []) {
    if (SENALES[senal]?.tono === 'aviso') extra += 2_000_000;
  }
  if (item.categoria === 'personas') extra += 250_000;
  return base + extra;
}

function comoItemContrato(c) {
  return {
    id: c.id,
    tipo: 'contrato',
    fecha: c.fecha,
    categoria: 'contratos',
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

function sumar(mapa, clave, importe) {
  if (!clave) return;
  const actual = mapa.get(clave) || { clave, n: 0, importe: 0 };
  actual.n += 1;
  if (typeof importe === 'number') actual.importe += importe;
  mapa.set(clave, actual);
}

const ordenar = (mapa, tope) =>
  [...mapa.values()].sort((a, b) => b.importe - a.importe || b.n - a.n).slice(0, tope);

async function fuentesDemo() {
  const boeCrudo = JSON.parse(await readFile(path.join(RAIZ, 'scripts/fixtures/boe-sumario.json'), 'utf8'));
  const hoy = comoISO(new Date());
  const boe = recorrerSumario(boeCrudo, { fecha: hoy, codigo: '', seccionNombre: null }, []);
  const atom = parsearXML(await readFile(path.join(RAIZ, 'scripts/fixtures/placsp.atom'), 'utf8'));
  const contratos = buscarTodos(atom, 'entry')
    .map((e) => contratoDesdeEntry(e, {}))
    .filter(Boolean)
    .map((c) => ({ ...c, fecha: hoy }));
  return { boe, contratos, avisos: ['MODO DEMO: datos de ejemplo, no son reales.'] };
}

async function main() {
  const dias = Number(argumento('dias', '7'));
  const salida = path.resolve(RAIZ, argumento('salida', 'data'));
  const demo = hayBandera('demo');
  const generado = new Date().toISOString();

  const fechas = ultimosDias(dias);
  const desdeISO = comoISO(fechas[fechas.length - 1]);
  const hastaISO = comoISO(fechas[0]);
  const fuentes = [];
  const avisos = [];

  console.log(`Ingesta ${desdeISO} → ${hastaISO}${demo ? ' (DEMO)' : ''}`);

  let itemsBOE = [];
  let contratos = [];
  let presupuesto = { disponible: false, motivo: 'No se ha intentado.' };

  if (demo) {
    const d = await fuentesDemo();
    itemsBOE = d.boe;
    contratos = d.contratos;
    avisos.push(...d.avisos);
    fuentes.push({ clave: 'demo', estado: 'ok', registros: itemsBOE.length + contratos.length, mensaje: 'Datos de ejemplo' });
  } else {
    // --- BOE -------------------------------------------------------------
    let diasLeidos = 0;
    const erroresBOE = [];
    for (const fecha of fechas) {
      try {
        const { items } = await sumarioDelDia(fecha);
        itemsBOE.push(...items);
        diasLeidos += 1;
      } catch (error) {
        erroresBOE.push(`${comoISO(fecha)}: ${error.message || error}`);
        console.warn(`  ⚠ ${error.message || error}`);
      }
    }
    fuentes.push({
      clave: 'boe',
      nombre: 'Boletín Oficial del Estado',
      estado: itemsBOE.length > 0 ? 'ok' : 'error',
      registros: itemsBOE.length,
      dias: diasLeidos,
      mensaje: erroresBOE.length ? erroresBOE.slice(0, 3).join(' · ') : null,
      url: 'https://www.boe.es/datosabiertos/',
    });

    // --- Plataforma de Contratación --------------------------------------
    try {
      const resultado = await leerContratos(desdeISO);
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

    // --- Presupuestos Generales del Estado (mejor esfuerzo) ---------------
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

  // --- Reparto en ficheros por dia ---------------------------------------
  const porDia = new Map();
  const anadir = (item) => {
    if (!item.fecha) return;
    if (!porDia.has(item.fecha)) porDia.set(item.fecha, { items: [], omitidos: 0, importeOmitido: 0 });
    porDia.get(item.fecha).items.push(item);
  };

  for (const b of itemsBOE) anadir(comoItemBOE(b));

  const totales = {
    contratos: 0,
    importeContratos: 0,
    importeAdjudicado: 0,
    sinCompetencia: 0,
    importeSinCompetencia: 0,
    documentosBOE: itemsBOE.length,
    subvenciones: 0,
    importeSubvenciones: 0,
    nombramientos: 0,
    libresDesignaciones: 0,
    plazas: 0,
  };

  const porOrganismo = new Map();
  const porEmpresa = new Map();
  const porTipo = new Map();
  const porProcedimiento = new Map();
  const porCategoria = new Map();

  for (const c of contratos) {
    const item = comoItemContrato(c);
    const importe = c.importeAdjudicado ?? c.importe ?? null;
    totales.contratos += 1;
    if (typeof c.importe === 'number') totales.importeContratos += c.importe;
    if (typeof c.importeAdjudicado === 'number') totales.importeAdjudicado += c.importeAdjudicado;
    if (c.senales.includes('sin-competencia')) {
      totales.sinCompetencia += 1;
      if (typeof importe === 'number') totales.importeSinCompetencia += importe;
    }
    sumar(porOrganismo, c.organismo, importe);
    if (c.adjudicatario) sumar(porEmpresa, c.adjudicatario, importe);
    sumar(porTipo, c.tipo, importe);
    sumar(porProcedimiento, c.procedimiento, importe);
    sumar(porCategoria, 'contratos', importe);

    const relevante =
      (typeof importe === 'number' && importe >= MINIMO_DETALLE) ||
      c.senales.some((s) => SENALES[s]?.tono === 'aviso');

    if (relevante) {
      anadir(item);
    } else if (c.fecha) {
      if (!porDia.has(c.fecha)) porDia.set(c.fecha, { items: [], omitidos: 0, importeOmitido: 0 });
      const dia = porDia.get(c.fecha);
      dia.omitidos += 1;
      if (typeof importe === 'number') dia.importeOmitido += importe;
    }
  }

  for (const b of itemsBOE) {
    if (b.categoria === 'subvenciones') {
      totales.subvenciones += 1;
      if (typeof b.importe === 'number') totales.importeSubvenciones += b.importe;
      sumar(porCategoria, 'subvenciones', b.importe);
    }
    if (b.subtipo === 'nombramiento') totales.nombramientos += 1;
    if (b.subtipo === 'libre-designacion') totales.libresDesignaciones += 1;
    if (b.subtipo === 'empleo') {
      const plazas = (b.titulo.match(/(\d{1,5})\s+plazas?/i) || [])[1];
      if (plazas) totales.plazas += Number(plazas);
    }
    if (b.categoria === 'presupuesto') sumar(porCategoria, 'presupuesto', b.importe);
    if (b.organismo && typeof b.importe === 'number' && b.categoria !== 'personas') {
      sumar(porOrganismo, b.organismo, b.importe);
    }
  }

  await mkdir(path.join(salida, 'dias'), { recursive: true });
  const resumenDias = [];
  for (const [fecha, dia] of [...porDia.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))) {
    dia.items.sort((a, b) => relevancia(b) - relevancia(a));
    const recortados = dia.items.slice(0, LIMITE_DIARIO);
    const importeDia = dia.items.reduce((t, i) => t + (Number(i.importeAdjudicado ?? i.importe) || 0), 0);
    await writeFile(
      path.join(salida, 'dias', `${fecha}.json`),
      JSON.stringify({
        fecha,
        generado,
        items: recortados,
        omitidos: dia.omitidos + Math.max(0, dia.items.length - recortados.length),
        importeOmitido: Math.round(dia.importeOmitido),
      }),
    );
    resumenDias.push({
      fecha,
      items: recortados.length,
      omitidos: dia.omitidos + Math.max(0, dia.items.length - recortados.length),
      importe: Math.round(importeDia + dia.importeOmitido),
      contratos: dia.items.filter((i) => i.tipo === 'contrato').length + dia.omitidos,
      personas: dia.items.filter((i) => i.categoria === 'personas').length,
    });
  }

  // --- Indice --------------------------------------------------------------
  const indice = {
    version: 1,
    generado,
    ventana: { desde: desdeISO, hasta: hastaISO, dias },
    demo,
    avisos,
    fuentes,
    totales: Object.fromEntries(Object.entries(totales).map(([k, v]) => [k, Math.round(v)])),
    dias: resumenDias,
    reparto: {
      porOrganismo: ordenar(porOrganismo, 40),
      empresas: ordenar(porEmpresa, 30),
      porTipo: ordenar(porTipo, 10),
      porProcedimiento: ordenar(porProcedimiento, 12),
      porCategoria: ordenar(porCategoria, 10),
    },
    presupuesto,
    umbrales: { importeAlto: IMPORTE_ALTO, minimoDetalle: MINIMO_DETALLE },
  };

  await writeFile(path.join(salida, 'index.json'), JSON.stringify(indice, null, 1));
  await writeFile(path.join(salida, 'glosario.json'), JSON.stringify(GLOSARIO, null, 1));
  await writeFile(path.join(salida, 'senales.json'), JSON.stringify(SENALES, null, 1));

  // --- Limpieza: no guardamos mas de DIAS_QUE_GUARDAMOS ficheros diarios ---
  if (existsSync(path.join(salida, 'dias'))) {
    const ficheros = (await readdir(path.join(salida, 'dias'))).filter((f) => f.endsWith('.json')).sort().reverse();
    for (const viejo of ficheros.slice(DIAS_QUE_GUARDAMOS)) {
      await rm(path.join(salida, 'dias', viejo));
    }
  }

  console.log(`\nResumen:`);
  console.log(`  Contratos leídos: ${totales.contratos} (${(totales.importeContratos / 1e6).toFixed(1)} M€ presupuestados)`);
  console.log(`  Sin competencia:  ${totales.sinCompetencia}`);
  console.log(`  Documentos BOE:   ${totales.documentosBOE}`);
  console.log(`  Días con datos:   ${resumenDias.length}`);
  for (const f of fuentes) console.log(`  Fuente ${f.clave}: ${f.estado}${f.mensaje ? ` — ${f.mensaje}` : ''}`);

  const sinDatos = fuentes.filter((f) => f.estado === 'error');
  if (sinDatos.length === fuentes.length) {
    console.error('\nNinguna fuente respondió. No se toca data/.');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
