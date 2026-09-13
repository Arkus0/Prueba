/** Pruebas de los lectores contra ficheros de ejemplo. No tocan la red. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parsearXML, buscarTodos, textoDe } from '../lib/xml.mjs';
import { importeEnTexto, numeroES, numeroCodice, jergaEn, conArticuloOrganismo, nombrePropio } from '../lib/texto.mjs';
import { senalesDeContrato, senalesDeBOE } from '../lib/senales.mjs';
import { recorrerSumario, fraseLlana } from '../sources/boe.mjs';
import { contratoDesdeEntry, leerResumen, importeCreible } from '../sources/placsp.mjs';
import { partidasDesdeCSV, partirCSV } from '../sources/pge.mjs';
import { localizar, provinciaDeCodigoPostal, provinciaDeNUTS } from '../lib/territorio.mjs';
import { sectorDeCPV } from '../lib/cpv.mjs';

const AQUI = path.dirname(new URL(import.meta.url).pathname);
const fixture = (nombre) => readFile(path.join(AQUI, '..', 'fixtures', nombre), 'utf8');

test('los números españoles y los CODICE se leen distinto y bien', () => {
  assert.equal(numeroES('1.234.567,89'), 1234567.89);
  assert.equal(numeroCodice('1234567.89'), 1234567.89);
  assert.equal(numeroCodice('1.234.567,89'), 1234567.89, 'algunos organismos publican a la española');
  assert.equal(numeroCodice('1234567,89'), 1234567.89);
  assert.equal(numeroES('no hay cifra'), null);
});

test('ante un importe con formato imposible, ninguna cifra', () => {
  // Este caso multiplicaba por cien el precio de un contrato real.
  assert.equal(numeroCodice('16.754.259.84'), null);
  assert.equal(numeroCodice('mil euros'), null);
  assert.equal(numeroCodice(''), null);
  assert.equal(numeroCodice('0.00'), 0);
});

test('un importe desmesurado se descarta en vez de publicarse', async () => {
  const { parsearXML: leer, buscarTodos: todos } = await import('../lib/xml.mjs');
  const xml = `<feed><entry><id>x</id><updated>2026-09-01T00:00:00Z</updated>
    <ContractFolderStatus><ProcurementProject><Name>Prueba</Name>
    <BudgetAmount><TaxExclusiveAmount>99999999999.00</TaxExclusiveAmount></BudgetAmount>
    </ProcurementProject></ContractFolderStatus></entry></feed>`;
  const contrato = contratoDesdeEntry(todos(leer(xml), 'entry')[0], {});
  assert.equal(contrato.importe, null);
  assert.ok(contrato.senales.includes('sin-importe'));
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
  assert.equal(conArticuloOrganismo('ALCALDÍA DEL AYUNTAMIENTO DE X'), 'la Alcaldía del Ayuntamiento de X');
  assert.equal(nombrePropio('LIMPIEZAS DEL NORTE S.A.'), 'Limpiezas del Norte SA');
});

test('con un organismo en plural, también el verbo', async () => {
  const { sujetoYVerbo } = await import('../lib/texto.mjs');
  assert.equal(sujetoYVerbo('MINISTERIO DE HACIENDA', 'abre un proceso'), 'El Ministerio de Hacienda abre un proceso');
  assert.equal(sujetoYVerbo('UNIVERSIDADES', 'abre un proceso'), 'Las Universidades abren un proceso');
  assert.equal(sujetoYVerbo('CORTES GENERALES', 'convoca plazas'), 'Las Cortes Generales convocan plazas');
  assert.equal(sujetoYVerbo('JUZGADOS DE PRIMERA INSTANCIA', 'publica algo'), 'Los Juzgados de Primera Instancia publican algo');
  // La palabra que va delante del verbo no se conjuga.
  assert.equal(sujetoYVerbo('UNIVERSIDADES', 'ya ha elegido'), 'Las Universidades ya han elegido');
  // En pasado no vale añadir una "n": se deja como está antes que inventarse una palabra.
  assert.equal(sujetoYVerbo('UNIVERSIDADES', 'no encontró a nadie'), 'Las Universidades no encontró a nadie');
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

test('de una convocatoria sacamos plazas, plazo y requisitos', async () => {
  const { detallesDesdeTexto, fechaLimite, pareceConvocatoria, plazoEn } = await import('../sources/oposiciones.mjs');

  const texto = 'Se convoca proceso selectivo para ingreso, por el sistema general de acceso libre y '
    + 'promoción interna, en el Cuerpo de Gestión Procesal y Administrativa, subgrupo A2, con un total de 250 plazas. '
    + 'Los aspirantes deberán estar en posesión del título de Diplomado universitario o equivalente. '
    + 'El plazo de presentación de solicitudes será de veinte días hábiles contados a partir del día siguiente al de la publicación. '
    + 'La solicitud se cumplimentará en el modelo 790 del servicio de Inscripción de Pruebas Selectivas. '
    + 'Los derechos de examen serán de 30,49 euros.';

  const d = detallesDesdeTexto(texto);
  assert.equal(d.plazas, 250);
  assert.equal(d.grupo, 'A2');
  assert.deepEqual(d.plazo, { dias: 20, tipo: 'hábiles' });
  assert.equal(d.tasa, '30,49');
  assert.ok(d.acceso.includes('Acceso libre'));
  assert.match(d.titulacion, /Diplomado universitario/);
  assert.match(d.comoApuntarse, /790/);

  // 20 días hábiles desde el sábado 12/09/2026, sin contar fines de semana.
  assert.equal(fechaLimite('2026-09-12', d.plazo), '2026-10-09');
  assert.equal(fechaLimite('2026-09-12', null), null);

  // Solo pedimos el texto completo de lo que es una convocatoria de verdad.
  assert.equal(pareceConvocatoria({ subtipo: 'empleo', titulo: 'Resolución por la que se convoca proceso selectivo' }), true);
  assert.equal(pareceConvocatoria({ subtipo: 'empleo', titulo: 'Resolución por la que se publica la relación de personas aprobadas' }), false);
  assert.equal(pareceConvocatoria({ subtipo: 'nombramiento', titulo: 'Se convoca algo' }), false);
  assert.equal(plazoEn('sin plazo aquí'), null);
});

test('de dónde es cada contrato: primero el dato oficial, luego las pistas', () => {
  // El municipio del INE dentro del nombre del organismo.
  assert.deepEqual(localizar({ organismo: 'Ayuntamiento de Vinarós' }), { provincia: '12', ccaa: '10', via: 'municipio' });
  assert.equal(localizar({ organismo: 'Ayuntamiento de Vitoria-Gasteiz-Junta de Gobierno Local' }).provincia, '01');

  // El nombre de la provincia, dicho con todas las letras.
  assert.equal(localizar({ organismo: 'Diputación Provincial de Soria' }).provincia, '42');
  assert.equal(localizar({ organismo: 'Cabildo Insular de Tenerife' }).ccaa, '05');

  // Entes autonómicos que no llevan el sitio en el nombre: comunidad sí, provincia no.
  assert.deepEqual(localizar({ organismo: 'Servicio Andaluz de Salud' }), { provincia: null, ccaa: '01', via: 'ente' });
  assert.equal(localizar({ organismo: 'Consellería de Sanidade- Sergas' }).ccaa, '12');

  // La plataforma en la que publica, cuando el nombre no dice nada.
  assert.deepEqual(
    localizar({ organismo: 'Consejería de Familia, Juventud y Asuntos Sociales', url: 'https://contratos-publicos.comunidad.madrid/x' }),
    { provincia: null, ccaa: '13', via: 'dominio' },
  );
  // La plataforma central NO es una pista territorial: la usa toda España.
  assert.equal(localizar({ organismo: 'Junta de Contratación', url: 'https://contrataciondelestado.es/x' }), null);

  // Ámbito estatal: no le toca ninguna provincia, y eso es la respuesta correcta.
  assert.equal(localizar({ organismo: 'Adif - Presidencia' }).estatal, true);
  assert.equal(localizar({ organismo: 'Adif - Presidencia' }).ccaa, null);

  // Lo que no se sabe se queda sin localizar. No se reparte a dedo.
  assert.equal(localizar({ organismo: 'Junta de Gobierno del Ayuntamiento las Rozas' }), null);
  assert.equal(localizar({ organismo: 'Gerencia Asistencial de Atención Primaria' }), null);
  assert.equal(localizar({}), null);

  // La dirección del CODICE manda sobre cualquier deducción por el nombre.
  assert.deepEqual(
    localizar({ organismo: 'Servicio Andaluz de Salud', direccion: { nuts: 'ES300' } }),
    { provincia: '28', ccaa: '13', via: 'codice-nuts' },
  );
  assert.equal(localizar({ organismo: 'Adif', direccion: { postal: '08015' } }).provincia, '08');

  assert.equal(provinciaDeCodigoPostal('46021'), '46');
  assert.equal(provinciaDeCodigoPostal('99999'), null);
  assert.equal(provinciaDeNUTS('ES618'), '41');
  assert.equal(provinciaDeNUTS('ES'), null);
});

test('el CPV se traduce a algo que se entienda, y si no, a nada', () => {
  assert.equal(sectorDeCPV(['45233142']), 'Obras y carreteras');
  assert.equal(sectorDeCPV(['85111500']), 'Sanidad y farmacia');
  assert.equal(sectorDeCPV(['72000000']), 'Informática y oficina');
  // Se usa el primero que sepamos traducir, no el primero a secas.
  assert.equal(sectorDeCPV(['99999999', '90911200']), 'Basuras, agua y limpieza');
  assert.equal(sectorDeCPV([]), null);
  assert.equal(sectorDeCPV(['99999999']), null);
  assert.equal(sectorDeCPV(null), null);
});

test('un importe imposible para quien lo firma no se da por bueno', () => {
  // El caso real: Alpedrete, 14.600 habitantes, 1.675 millones en basuras.
  assert.equal(importeCreible(1_675_425_984, 'local'), false);
  // Pero las concesiones municipales grandes de verdad siguen pasando.
  assert.equal(importeCreible(153_390_000, 'local'), true);
  assert.equal(importeCreible(151_300_000, 'local'), true);
  // Y lo que sí puede permitirse el Estado, también.
  assert.equal(importeCreible(690_000_000, 'estado'), true);
  assert.equal(importeCreible(727_700_000, 'autonomica'), true);
  // Sin nivel conocido se usa el tope más holgado, no el más estricto.
  assert.equal(importeCreible(690_000_000, null), true);
  assert.equal(importeCreible(9_000_000_000, null), false);
  // Sin importe no hay nada que descreer.
  assert.equal(importeCreible(null, 'local'), true);
});
