/**
 * Revisa lo que ha dejado la ingesta antes de publicarlo.
 * Si algo no cuadra, sale con error y la Action no commitea datos rotos.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.resolve(RAIZ, process.argv[2] || 'data');

const problemas = [];
const avisos = [];

function exigir(condicion, mensaje) {
  if (!condicion) problemas.push(mensaje);
}

const leer = async (relativa) => JSON.parse(await readFile(path.join(DATA, relativa), 'utf8'));

const indice = await leer('index.json').catch((error) => {
  problemas.push(`No se puede leer index.json: ${error.message}`);
  return null;
});

if (indice) {
  exigir(indice.version >= 1, 'index.json sin versión reconocible');
  exigir(Boolean(indice.cobertura?.desde), 'index.json sin cobertura de fechas');
  exigir(typeof indice.generado === 'string', 'index.json sin fecha de generación');
  exigir(Array.isArray(indice.fuentes) && indice.fuentes.length > 0, 'index.json sin lista de fuentes');
  exigir(Array.isArray(indice.dias), 'index.json sin días');

  // El mapa: que los agregados existan y que los códigos sean comunidades de
  // verdad. Si la cobertura se hunde es que la Plataforma ha cambiado algo y
  // hay que mirarlo, pero no es motivo para no publicar lo demás.
  const porCCAA = indice.reparto?.porCCAA;
  exigir(Array.isArray(porCCAA), 'index.json sin reparto.porCCAA: el mapa se quedaría vacío');
  for (const fila of porCCAA || []) {
    exigir(/^(0[1-9]|1[0-9])$/.test(fila.clave), `comunidad desconocida en reparto.porCCAA: ${fila.clave}`);
    exigir(typeof fila.nombre === 'string' && fila.nombre.length > 0, `comunidad sin nombre: ${fila.clave}`);
  }

  const territorio = indice.territorio;
  if (territorio) {
    const total = territorio.localizados + territorio.estatales + territorio.sinLocalizar;
    const cobertura = total ? territorio.localizados / total : 1;
    if (total > 0 && cobertura < 0.7) {
      avisos.push(`solo se localiza el ${Math.round(cobertura * 100)}% de los contratos (antes rondaba el 85%): revisar scripts/lib/territorio.mjs`);
    }
  } else {
    avisos.push('index.json sin resumen de territorio');
  }

  const vivas = (indice.fuentes || []).filter((f) => f.estado === 'ok');
  exigir(vivas.length > 0, 'Ninguna fuente oficial respondió: no publicamos nada');

  for (const fuente of indice.fuentes || []) {
    if (fuente.estado !== 'ok') avisos.push(`fuente ${fuente.clave}: ${fuente.estado}${fuente.mensaje ? ` — ${fuente.mensaje}` : ''}`);
  }

  const ficheros = await readdir(path.join(DATA, 'dias')).catch(() => []);
  exigir(ficheros.length > 0, 'No hay ningún fichero diario en data/dias');

  let totalItems = 0;
  let sinEnlace = 0;
  let conFrase = 0;

  for (const fichero of ficheros) {
    const dia = await leer(path.join('dias', fichero));
    exigir(dia.fecha === fichero.replace('.json', ''), `${fichero}: la fecha de dentro no coincide con el nombre`);
    exigir(Array.isArray(dia.items), `${fichero}: sin lista de items`);
    exigir(Boolean(dia.resumen), `${fichero}: sin resumen del día`);
    for (const item of dia.items) {
      totalItems += 1;
      exigir(Boolean(item.id), `${fichero}: hay un item sin identificador`);
      exigir(Boolean(item.titulo || item.frase), `${fichero}: item ${item.id} sin texto`);
      exigir(item.fecha === dia.fecha, `${fichero}: item ${item.id} con fecha de otro día`);
      if (!item.url && !item.urlPdf) sinEnlace += 1;
      if (item.frase) conFrase += 1;
    }
  }

  // Cada registro debe poder comprobarse en su fuente: es la regla de la casa.
  exigir(sinEnlace === 0, `${sinEnlace} registros sin enlace al documento oficial`);

  console.log(`Revisión de ${DATA}`);
  console.log(`  Cobertura:         ${indice.cobertura?.desde} → ${indice.cobertura?.hasta}`);
  console.log(`  Días:              ${ficheros.length}`);
  console.log(`  Registros:         ${totalItems}`);
  console.log(`  Con frase llana:   ${conFrase} (${totalItems ? Math.round((conFrase / totalItems) * 100) : 0}%)`);
  console.log(`  Fuentes vivas:     ${vivas.map((f) => f.clave).join(', ') || 'ninguna'}`);
}

for (const aviso of avisos) console.warn(`  aviso: ${aviso}`);

if (problemas.length) {
  console.error('\nProblemas:');
  for (const p of problemas) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log('\nTodo correcto.');
