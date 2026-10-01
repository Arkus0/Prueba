import test from 'node:test';
import assert from 'node:assert/strict';

import {
  plazasEn,
  marcarAbiertas,
  VERSION_EXTRACTOR_OPOSICIONES,
} from '../sources/oposiciones.mjs';

test('no confunde Plaza número con el número de plazas', () => {
  assert.equal(
    plazasEn('Número de plazas: Una. Plaza número: 22825.'),
    1,
  );
  assert.equal(
    plazasEn('Número de plazas: Una. Plaza número: 22899.'),
    1,
  );
});

test('suma las plazas de anexos con varias fichas', () => {
  const texto = [
    'Número de plazas: Una. Plaza número: 22825.',
    'Número de plazas: Uno. Plaza número: 22830.',
    'Número de plazas: 2. Plaza número: 22900.',
  ].join(' ');
  assert.equal(plazasEn(texto), 4);
});

test('un total explícito manda sobre el desglose del anexo', () => {
  const texto = [
    'Número total de plazas: 3.',
    'Número de plazas: Una. Plaza número: 10.',
    'Número de plazas: Una. Plaza número: 11.',
    'Número de plazas: Una. Plaza número: 12.',
  ].join(' ');
  assert.equal(plazasEn(texto), 3);
});

test('mantiene las formas narrativas habituales', () => {
  assert.equal(plazasEn('Se convoca proceso selectivo con un total de 250 plazas.'), 250);
  assert.equal(plazasEn('Se convocan 1.115 plazas de acceso libre.'), 1115);
});

test('las correcciones y listas provisionales no sobreviven como convocatoria abierta', () => {
  const falsas = marcarAbiertas([
    {
      id: 'x',
      fecha: '2026-09-12',
      titulo: 'Resolución por la que se corrigen errores en la relación provisional de personas admitidas y excluidas del proceso selectivo.',
      limite: '2026-09-30',
      extractorVersion: VERSION_EXTRACTOR_OPOSICIONES,
    },
  ], '2026-09-12');
  assert.deepEqual(falsas, []);
});

test('variantes de "corregir" y "relación ... de personas" también se descartan', async () => {
  const { pareceConvocatoria } = await import('../sources/oposiciones.mjs');
  // "se corrigen errores" (sin "corrección de errores") no se colaba antes.
  assert.equal(
    pareceConvocatoria({
      subtipo: 'empleo',
      titulo: 'Resolución por la que se corrigen errores en la relación provisional de personas admitidas y excluidas del proceso selectivo.',
    }),
    false,
  );
  // "relación provisional de personas admitidas" (con el adjetivo en medio) tampoco.
  assert.equal(
    pareceConvocatoria({
      subtipo: 'empleo',
      titulo: 'Resolución por la que se publica la relación definitiva de personas aprobadas en el proceso selectivo.',
    }),
    false,
  );
  // Pero una convocatoria de verdad sigue entrando.
  assert.equal(
    pareceConvocatoria({
      subtipo: 'empleo',
      titulo: 'Resolución por la que se convocan pruebas selectivas de acceso libre.',
    }),
    true,
  );
});
