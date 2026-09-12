/** Pruebas de los lectores contra ficheros de ejemplo. No tocan la red. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parsearXML, buscarTodos, textoDe } from '../lib/xml.mjs';
import { importeEnTexto, numeroES, numeroCodice, jergaEn, conArticuloOrganismo, nombrePropio } from '../lib/texto.mjs';
import { senalesDeContrato, senalesDeBOE } from '../lib/senales.mjs';
import { recorrerSumario, fraseLlana } from '../sources/boe.mjs';
import { contratoDesdeEntry, leerResumen } from '../sources/placsp.mjs';
import { partidasDesdeCSV, partirCSV } from '../sources/pge.mjs';

const AQUI = path.dirname(new URL(import.meta.url).pathname);
const fixture = (nombre) => readFile(path.join(AQUI, '..', 'fixtures', nombre), 'utf8');

test('los números españoles y los CODICE se leen distinto y bien', () => {
  assert.equal(numeroES('1.234.567,89'), 1234567.89);
  assert.equal(numeroCodice('1234567.89'), 1234567.89);
  assert.equal(numeroES('no hay cifra'), null);
});

test('solo se acepta un importe si lleva euros al lado', () => {
  assert.equal(importeEnTexto('ayudas por 3.450.000,50 euros').importe, 3450000.5);
  assert.equal(importeEnTexto('12 millones de euros').importe, 12e6);
  assert.equal(importeEnTexto('2,5 mil millones de euros').importe, 2.5e9);
  assert.equal(importeEnTexto('Resolución de 5 de septiembre de 2026'), null);
});

test('el artículo del organismo concuerda', () => {
  assert.equal(conArticuloOrganismo('MINISTERIO DE DEFENSA'), 'el Ministerio de Defensa');
  assert.equal(conArticuloOrganismo('DIRECCIÓN GENERAL DE TRÁFICO'), 'la Dirección General de Tráfico');
  assert.equal(nombrePropio('LIMPIEZAS DEL NORTE S.A.'), 'Limpiezas del Norte SA');
});

test('el XML se lee por nombre local, sin importar el prefijo', () => {
  const arbol = parsearXML('<a:feed xmlns:a="x"><b:entry><c:Name>Hola &amp; adiós</c:Name></b:entry></a:feed>');
  assert.equal(buscarTodos(arbol, 'entry').length, 1);
  assert.equal(textoDe(arbol, 'Name'), 'Hola & adiós');
});

test('el sumario del BOE se recorre venga como venga (objeto o lista)', async () => {
  const datos = JSON.parse(await fixture('boe-sumario.json'));
  const items = recorrerSumario(datos, { fecha: '2026-09-11', codigo: '', seccionNombre: null }, []);

  assert.equal(items.length, 8, 'se queda lo que mueve dinero o puestos');
  assert.ok(!items.some((i) => i.id.startsWith('BOE-B-2026-1')), 'los edictos de justicia se descartan');

  const porId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(porId['BOE-A-2026-18010'].categoria, 'personas');
  assert.equal(porId['BOE-A-2026-18010'].subtipo, 'nombramiento');
  assert.equal(porId['BOE-A-2026-18011'].subtipo, 'cese');
  assert.equal(porId['BOE-A-2026-18020'].subtipo, 'libre-designacion');
  assert.deepEqual(porId['BOE-A-2026-18020'].senales, ['libre-designacion']);
  assert.equal(porId['BOE-A-2026-18030'].importe, 12500000);
  assert.equal(porId['BOE-A-2026-18001'].categoria, 'presupuesto');
  assert.match(porId['BOE-A-2026-18010'].url, /^https:\/\/boe\.es\/diario_boe/);
  assert.match(porId['BOE-A-2026-18010'].urlPdf, /^https:\/\/boe\.es\/boe\/dias/);
});

test('si no estamos seguros de la frase, no la inventamos', () => {
  assert.equal(fraseLlana('Resolución por la que se aprueba no se sabe qué.', 'nombramiento', 'MINISTERIO X'), null);
  assert.match(
    fraseLlana('Resolución por la que se nombra Directora General de Costas a doña Ana Gil.', 'nombramiento', 'MINISTERIO'),
    /Nombran a Ana Gil/,
  );
});

test('un contrato CODICE se normaliza con sus señales', async () => {
  const arbol = parsearXML(await fixture('placsp.atom'));
  const entradas = buscarTodos(arbol, 'entry');
  assert.equal(entradas.length, 3);

  const adjudicado = contratoDesdeEntry(entradas[0], {});
  assert.equal(adjudicado.organismo, 'Subsecretaría de Sanidad');
  assert.equal(adjudicado.importe, 4250000);
  assert.equal(adjudicado.importeAdjudicado, 3890000);
  assert.equal(adjudicado.adjudicatario, 'Limpiezas Integrales del Norte SA');
  assert.equal(adjudicado.procedimiento, 'Concurso abierto');
  assert.equal(adjudicado.ofertas, 6);
  assert.deepEqual(adjudicado.cpv, ['90911200']);
  assert.ok(!adjudicado.senales.includes('sin-competencia'));

  const negociado = contratoDesdeEntry(entradas[1], {});
  assert.ok(negociado.senales.includes('sin-competencia'));
  assert.ok(negociado.senales.includes('un-licitador'));

  const sinAdjudicar = contratoDesdeEntry(entradas[2], {});
  assert.equal(sinAdjudicar.adjudicatario, null);
  assert.match(sinAdjudicar.frase, /busca quien se encargue/);
});

test('el resumen en castellano sirve de red de seguridad', () => {
  const datos = leerResumen('Id licitación: 2026/A/1; Órgano de Contratación: AYUNTAMIENTO X; Importe: 1000.00 EUR; Estado: Publicada');
  assert.equal(datos['id licitacion'], '2026/A/1');
  assert.equal(datos['organo de contratacion'], 'AYUNTAMIENTO X');
  assert.equal(datos.estado, 'Publicada');
});

test('las señales describen hechos, y sin dato no hay señal', () => {
  assert.deepEqual(
    senalesDeContrato({ objeto: 'Obra', procedimientoCodigo: '4', ofertas: 1, importe: 2e6 }).sort(),
    ['importe-alto', 'sin-competencia', 'un-licitador'],
  );
  assert.deepEqual(senalesDeContrato({ objeto: 'Sillas', procedimientoCodigo: '1', ofertas: 5, importe: null }), ['sin-importe']);
  assert.deepEqual(senalesDeBOE({ titulo: 'provisión por el sistema de libre designación', categoria: 'personas' }), ['libre-designacion']);
});

test('el CSV del presupuesto solo se acepta si se entiende', () => {
  assert.deepEqual(partirCSV('a;"b;c";d', ';'), ['a', 'b;c', 'd']);
  assert.equal(partidasDesdeCSV('cosa;otra\n1;2\n3;4'), null, 'sin columnas reconocibles, nada');
  const bueno = partidasDesdeCSV('Politica de gasto;Importe\nPensiones;100\nSanidad;50\nDefensa;25');
  assert.equal(bueno.length, 3);
  assert.equal(bueno[0].importe, 100);
});

test('el glosario cubre la jerga que detectamos', async () => {
  const { GLOSARIO } = await import('../lib/texto.mjs');
  for (const clave of jergaEn('libre designación, negociado sin publicidad, subvención, contrato menor, acuerdo marco')) {
    assert.ok(GLOSARIO[clave], `falta la explicación de "${clave}"`);
  }
});
