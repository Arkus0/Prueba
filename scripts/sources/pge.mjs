/**
 * Presupuestos Generales del Estado: a donde esta previsto que vaya el dinero.
 *
 * Es la fuente menos amable de las tres: Hacienda publica el detalle en hojas
 * de calculo y PDF, no en una API estable. Aqui intentamos, por orden, las
 * vias automaticas que existen, y si ninguna responde lo decimos: la pestana
 * de la app mostrara el aviso en vez de una cifra inventada.
 */

import { bajar } from '../lib/red.mjs';
import { numeroES, nombrePropio } from '../lib/texto.mjs';

const CATALOGO = 'https://datos.gob.es/apidata/catalog/dataset/title';

/** Consultas al catalogo nacional de datos abiertos, de mas a menos concreta. */
const BUSQUEDAS = [
  'presupuestos-generales-del-estado-politica-de-gasto',
  'presupuestos-generales-del-estado',
  'presupuesto-de-gastos',
];

/** Divide una linea de CSV respetando las comillas. */
export function partirCSV(linea, separador) {
  const campos = [];
  let actual = '';
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (entreComillas && linea[i + 1] === '"') { actual += '"'; i++; }
      else entreComillas = !entreComillas;
    } else if (c === separador && !entreComillas) {
      campos.push(actual.trim());
      actual = '';
    } else {
      actual += c;
    }
  }
  campos.push(actual.trim());
  return campos;
}

const sinTildes = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Busca en un CSV una columna de concepto y otra de importe y agrega por concepto.
 * Devuelve null si el fichero no tiene esa forma: preferimos no publicar nada
 * antes que publicar una tabla mal entendida.
 */
export function partidasDesdeCSV(texto) {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim());
  if (lineas.length < 3) return null;

  const separador = (lineas[0].match(/;/g) || []).length >= (lineas[0].match(/,/g) || []).length ? ';' : ',';
  const cabecera = partirCSV(lineas[0], separador).map(sinTildes);

  const columnaConcepto = cabecera.findIndex((c) => /politica|programa|seccion|ministerio|capitulo|descripcion|denominacion/.test(c));
  const columnaImporte = cabecera.findIndex((c) => /importe|credito|total|presupuesto|euros|consolidado|definitiv/.test(c));
  if (columnaConcepto === -1 || columnaImporte === -1) return null;

  const acumulado = new Map();
  for (const linea of lineas.slice(1)) {
    const campos = partirCSV(linea, separador);
    const concepto = campos[columnaConcepto];
    const importe = numeroES(campos[columnaImporte]);
    if (!concepto || importe === null || importe <= 0) continue;
    const clave = concepto.trim();
    acumulado.set(clave, (acumulado.get(clave) || 0) + importe);
  }
  if (acumulado.size < 3) return null;

  return [...acumulado.entries()]
    .map(([nombre, importe]) => ({ nombre: nombrePropio(nombre), importe: Math.round(importe) }))
    .sort((a, b) => b.importe - a.importe)
    .slice(0, 60);
}

async function distribucionesDelCatalogo(consulta) {
  const respuesta = await bajar(`${CATALOGO}/${consulta}?_pageSize=20&_page=0`, {
    tipo: 'json',
    cabeceras: { Accept: 'application/json' },
    intentos: 2,
  });
  const resultados = respuesta?.result?.items || [];
  const urls = [];
  for (const dataset of resultados) {
    const titulo = JSON.stringify(dataset.title || '');
    const distribuciones = Array.isArray(dataset.distribution) ? dataset.distribution : [dataset.distribution].filter(Boolean);
    for (const d of distribuciones) {
      const formato = String(d?.format?.value || d?.format || '').toLowerCase();
      const url = d?.accessURL || d?.downloadURL;
      if (url && /csv/.test(formato)) urls.push({ url, titulo });
    }
  }
  return urls;
}

/** Devuelve las partidas del presupuesto, o el motivo por el que no hay. */
export async function leerPresupuesto(registro = console) {
  const intentos = [];

  for (const consulta of BUSQUEDAS) {
    let candidatos = [];
    try {
      candidatos = await distribucionesDelCatalogo(consulta);
    } catch (error) {
      intentos.push(`catálogo "${consulta}": ${error.message || error}`);
      continue;
    }

    for (const candidato of candidatos.slice(0, 4)) {
      try {
        const csv = await bajar(candidato.url, { intentos: 1, tiempoLimiteMs: 30000 });
        const partidas = partidasDesdeCSV(csv);
        if (partidas && partidas.length) {
          registro.log?.(`  PGE: ${partidas.length} partidas desde ${candidato.url}`);
          return {
            disponible: true,
            fuente: 'datos.gob.es',
            url: candidato.url,
            titulo: candidato.titulo,
            total: partidas.reduce((t, p) => t + p.importe, 0),
            partidas,
          };
        }
        intentos.push(`${candidato.url}: el CSV no tiene columnas de concepto e importe reconocibles`);
      } catch (error) {
        intentos.push(`${candidato.url}: ${error.message || error}`);
      }
    }
  }

  return {
    disponible: false,
    motivo:
      'No hemos podido leer automáticamente el presupuesto por partidas. Hacienda lo publica en hojas de cálculo y PDF, no en una API estable.',
    intentos: intentos.slice(0, 6),
  };
}
