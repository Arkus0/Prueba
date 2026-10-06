// Tests de la lógica pura del pipeline (agrupación, clasificación, dedup, cola).
// Ejecutar:  node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LogicEngine,
  parseSnapshot,
  parseOptionLineStrict,
  parseOptionLineLoose,
  isQuestionText,
  buildUserPayload,
  parseAnswer,
  normalizeLines,
} from '../js/logic.js';

const MERCURIO_Q = '¿Qué planeta está más cerca del Sol?';
const MERCURIO_OPTS = ['A) Venus', 'B) Marte', 'C) Mercurio', 'D) Tierra'];
const CIELO = 'por que el cielo es azul';

function fullText(q, opts) {
  return [q, ...opts].join('\n');
}

function makeEngine(config = {}) {
  const calls = [];
  const events = [];
  const engine = new LogicEngine({
    config,
    llmCall: async (payload) => {
      calls.push(payload);
      return 'RESPUESTA: C) Mercurio\n\nEXPLICACIÓN: Mercurio es el planeta más cercano al Sol.';
    },
  });
  for (const name of ['message', 'duplicate', 'queued', 'asking', 'answer', 'error', 'dropped']) {
    engine.on(name, (d) => events.push({ name, data: d }));
  }
  return { engine, calls, events };
}

// ---------------------------------------------------------------------------
// Unitarios de parseo
// ---------------------------------------------------------------------------

test('parseOptionLineStrict reconoce delimitadores habituales y confusiones de OCR', () => {
  assert.deepEqual(parseOptionLineStrict('A) Venus'), { letter: 'A', text: 'Venus' });
  assert.deepEqual(parseOptionLineStrict('B. Marte'), { letter: 'B', text: 'Marte' });
  assert.deepEqual(parseOptionLineStrict('(C) Mercurio'), { letter: 'C', text: 'Mercurio' });
  assert.deepEqual(parseOptionLineStrict('D - Tierra'), { letter: 'D', text: 'Tierra' });
  assert.deepEqual(parseOptionLineStrict('4) 388'), { letter: 'A', text: '388' });
  assert.equal(parseOptionLineStrict('388 408'), null);
  assert.equal(parseOptionLineStrict('Qué planeta'), null);
});

test('parseOptionLineLoose acepta letra suelta seguida de dígito/mayúscula, no frases', () => {
  assert.deepEqual(parseOptionLineLoose('A 388'), { letter: 'A', text: '388' });
  assert.equal(parseOptionLineLoose('A continuación veremos'), null);
});

test('parseSnapshot agrupa opciones y mantiene el enunciado como cabecera', () => {
  const snap = parseSnapshot([MERCURIO_Q, ...MERCURIO_OPTS]);
  assert.equal(snap.header, MERCURIO_Q);
  assert.deepEqual(snap.options.map(o => o.letter), ['A', 'B', 'C', 'D']);
  assert.equal(snap.options[2].text, 'Mercurio');
});

test('parseSnapshot acepta opciones con letra suelta si la secuencia es consecutiva', () => {
  const snap = parseSnapshot(['¿Cuánto es 17 × 24?', 'A 388', 'B 408', 'C 418', 'D 428']);
  assert.equal(snap.header, '¿Cuánto es 17 × 24?');
  assert.deepEqual(snap.options.map(o => o.text), ['388', '408', '418', '428']);
});

test('parseSnapshot no trata frases normales como opciones sueltas', () => {
  const snap = parseSnapshot(['A continuación veremos los resultados', 'Los datos sorprenden']);
  assert.equal(snap.options.length, 0);
  assert.ok(snap.header.includes('resultados'));
});

test('isQuestionText detecta interrogaciones y arrancadas interrogativas', () => {
  assert.ok(isQuestionText('¿Cuánto es 2+2?'));
  assert.ok(isQuestionText(CIELO));
  assert.ok(isQuestionText('What is the capital'));
  assert.ok(!isQuestionText('Buenas, bienvenidos a la presentación'));
});

test('normalizeLines une palabras cortadas por guion y tira ruido', () => {
  const lines = normalizeLines('planeta-\nario\n   ###   \nHola   mundo');
  assert.deepEqual(lines, ['planetaario', 'Hola mundo']);
});

test('buildUserPayload formatea pregunta y opciones', () => {
  const p = buildUserPayload({ header: MERCURIO_Q, options: [
    { letter: 'A', text: 'Venus' }, { letter: 'B', text: 'Marte' },
    { letter: 'C', text: 'Mercurio' }, { letter: 'D', text: 'Tierra' },
  ] });
  assert.equal(p, `${MERCURIO_Q}\n\nA) Venus\nB) Marte\nC) Mercurio\nD) Tierra`);
});

test('parseAnswer extrae RESPUESTA y EXPLICACIÓN', () => {
  const r = parseAnswer('RESPUESTA: C) Canberra\n\nEXPLICACIÓN: Canberra es la capital federal de Australia.');
  assert.equal(r.answerLine, 'C) Canberra');
  assert.ok(r.explanation.includes('capital federal'));
});

test('parseAnswer tolera respuestas sin explicación (formato solo opción)', () => {
  const r = parseAnswer('RESPUESTA: C) Mercurio');
  assert.equal(r.answerLine, 'C) Mercurio');
  assert.equal(r.explanation, '');
});

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

test('test completo en pantalla: una sola llamada con las 4 opciones', async () => {
  const { engine, calls } = makeEngine();
  engine.feed(fullText(MERCURIO_Q, MERCURIO_OPTS), 0);
  engine.feed(fullText(MERCURIO_Q, MERCURIO_OPTS), 2000);
  engine.feed(fullText(MERCURIO_Q, MERCURIO_OPTS), 4000);
  await engine.idle();
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('¿Qué planeta está más cerca del Sol?'));
  for (const o of MERCURIO_OPTS) assert.ok(calls[0].includes(o));
});

test('opciones reveladas por fases: se agrupan antes de enviar', async () => {
  const { engine, calls } = makeEngine();
  engine.feed('¿Cuánto es 17 × 24?', 0);
  engine.feed('¿Cuánto es 17 × 24?', 2000);
  engine.feed('¿Cuánto es 17 × 24?\nA 388\nB 408', 4000);
  engine.feed('¿Cuánto es 17 × 24?\nA 388\nB 408\nC 418\nD 428', 6000);
  engine.feed('¿Cuánto es 17 × 24?\nA 388\nB 408\nC 418\nD 428', 8000);
  engine.feed('¿Cuánto es 17 × 24?\nA 388\nB 408\nC 418\nD 428', 10000);
  await engine.idle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0], '¿Cuánto es 17 × 24?\n\nA) 388\nB) 408\nC) 418\nD) 428');
});

test('pregunta simple sin formato test: se envía tal cual y una sola vez', async () => {
  const { engine, calls } = makeEngine();
  engine.feed(CIELO, 0);
  engine.feed(CIELO, 2000);
  engine.feed(CIELO, 4000);
  engine.feed(CIELO, 6000);
  await engine.idle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0], CIELO);
});

test('pregunta repetida: no se consulta dos veces; se re-muestra la respuesta en caché', async () => {
  const { engine, calls, events } = makeEngine();
  const t = fullText(MERCURIO_Q, MERCURIO_OPTS);
  engine.feed(t, 0);
  engine.feed(t, 2000);
  engine.feed(t, 4000);
  await engine.idle();
  // la pregunta sigue en pantalla varios ciclos más (no debe reenviarse)
  engine.feed(t, 6000);
  engine.feed(t, 8000);
  engine.feed(t, 10000);
  engine.feed(t, 12000);
  await engine.idle();
  assert.equal(calls.length, 1);
  assert.ok(events.some(e => e.name === 'duplicate'));
  const cached = events.filter(e => e.name === 'answer');
  assert.equal(cached.length, 2); // original + re-mostrada desde caché
  assert.equal(cached[1].data.fromCache, true);
});

test('mensaje que no es pregunta: no se consulta al LLM', async () => {
  const { engine, calls, events } = makeEngine();
  const msg = 'Buenas, bienvenidos a la presentación';
  for (let t = 0; t <= 10000; t += 2000) engine.feed(msg, t);
  await engine.idle();
  assert.equal(calls.length, 0);
  assert.ok(events.some(e => e.name === 'message'));
});

test('una opción aislada no se envía nunca como mensaje independiente', async () => {
  const { engine, calls } = makeEngine();
  for (let t = 0; t <= 28000; t += 2000) engine.feed('A) Venus', t);
  engine.tick(31000);
  await engine.idle();
  assert.equal(calls.length, 0);
});

test('cambio de pregunta: se finaliza la anterior y se procesa la nueva', async () => {
  const { engine, calls } = makeEngine();
  const t1 = fullText(MERCURIO_Q, MERCURIO_OPTS);
  engine.feed(t1, 0);
  engine.feed(t1, 2000);
  engine.feed(t1, 4000);
  const q2 = '¿Cuál es la capital de Australia?';
  const t2 = fullText(q2, ['A) Sídney', 'B) Melbourne', 'C) Canberra', 'D) Perth']);
  engine.feed(t2, 6000);
  engine.feed(t2, 8000);
  engine.feed(t2, 10000);
  await engine.idle();
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes(q2));
  assert.ok(calls[1].includes('C) Canberra'));
});

test('jitter de OCR entre ciclos: lecturas casi idénticas cuentan como estables', async () => {
  const { engine, calls } = makeEngine();
  const a = fullText(MERCURIO_Q, MERCURIO_OPTS);
  const b = fullText('¿Qué planeta está más cerca del Sol?', ['A) Venus', 'B) Marte', 'C) Mercurio', 'D) Tierra.']);
  engine.feed(a, 0);
  engine.feed(b, 2000);
  engine.feed(a, 4000);
  engine.feed(b, 6000);
  await engine.idle();
  assert.equal(calls.length, 1);
});

test('opciones que aparecen tras enviar una pregunta simple: se envía una revisión con opciones', async () => {
  const { engine, calls, events } = makeEngine({ testGraceMs: 2000 });
  const q = '¿Cuál es el planeta más cercano al Sol?';
  engine.feed(q, 0);
  engine.feed(q, 2000);
  await engine.idle();
  assert.equal(calls.length, 1); // enviado como pregunta simple
  assert.equal(calls[0], q);

  const conOpts = q + '\nA) Venus\nB) Marte\nC) Mercurio\nD) Tierra';
  engine.feed(conOpts, 4000);
  engine.feed(conOpts, 6000);
  engine.feed(conOpts, 8000);
  await engine.idle();
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes('C) Mercurio'));
  const answers = events.filter(e => e.name === 'answer');
  assert.equal(answers[1].data.revision, true);
});

test('error del LLM: se emite evento de error y la cola sigue', async () => {
  let fail = true;
  const events = [];
  const engine = new LogicEngine({
    llmCall: async () => { if (fail) throw new Error('boom'); return 'RESPUESTA: ok'; },
    config: { askRetries: 0 },
  });
  for (const n of ['error', 'answer']) engine.on(n, d => events.push({ name: n, data: d }));
  const t = fullText(MERCURIO_Q, MERCURIO_OPTS);
  engine.feed(t, 0); engine.feed(t, 2000); engine.feed(t, 4000);
  await engine.idle();
  assert.ok(events.some(e => e.name === 'error'));
  assert.equal(events.filter(e => e.name === 'answer').length, 0);
});

test('la cola acota las tareas pendientes y descarta las más antiguas', async () => {
  const { engine, calls, events } = makeEngine({ maxPending: 2 });
  const qs = [
    '¿Pregunta uno?', '¿Pregunta dos?', '¿Pregunta tres?', '¿Pregunta cuatro?',
  ];
  let t = 0;
  for (const q of qs) {
    engine.feed(q, t); engine.feed(q, t + 2000); engine.feed(q, t + 4000);
    t += 6000;
  }
  await engine.idle();
  assert.ok(calls.length <= 4 && calls.length >= 2);
  assert.ok(events.some(e => e.name === 'dropped') || calls.length === 4);
});

// ---------------------------------------------------------------------------
// Varias preguntas tipo test visibles a la vez
// ---------------------------------------------------------------------------

test('dos preguntas numeradas a la vez: se separan y se consulta una por una', async () => {
  const { engine, calls } = makeEngine();
  const pantalla = [
    '1. ¿Qué rama de la filosofía estudia el conocimiento?',
    'A) La ética', 'B) La epistemología', 'C) La estética', 'D) La lógica',
    '2. ¿Quién escribió la Crítica de la razón pura?',
    'A) Hegel', 'B) Kant', 'C) Hume', 'D) Nietzsche',
  ].join('\n');
  engine.feed(pantalla, 0);
  engine.feed(pantalla, 2000);
  engine.feed(pantalla, 4000);
  await engine.idle();
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes('epistemología'));
  assert.ok(calls[0].includes('1.'));
  assert.ok(calls[1].includes('Kant'));
  assert.ok(calls[1].includes('2.'));
  assert.ok(!calls[1].includes('epistemología'));
});

test('tres preguntas apiladas sin numerar: tres consultas independientes', async () => {
  const { engine, calls } = makeEngine();
  const pantalla = [
    '¿Cuál es la capital de Australia?',
    'A) Sídney', 'B) Melbourne', 'C) Canberra', 'D) Perth',
    '¿Qué planeta está más cerca del Sol?',
    'A) Venus', 'B) Marte', 'C) Mercurio', 'D) Tierra',
    '¿Cuánto es 17 × 24?',
    'A 388', 'B 408', 'C 418', 'D 428',
  ].join('\n');
  engine.feed(pantalla, 0);
  engine.feed(pantalla, 2000);
  engine.feed(pantalla, 4000);
  await engine.idle();
  assert.equal(calls.length, 3);
  assert.ok(calls.some(c => c.includes('Canberra')));
  assert.ok(calls.some(c => c.includes('Mercurio')));
  assert.ok(calls.some(c => c.includes('428')));
});

test('una sola pregunta numerada no se parte en varias', async () => {
  const { engine, calls } = makeEngine();
  const pantalla = '1. ¿Cuál es la capital de Francia?\nA) Roma\nB) París\nC) Berlín\nD) Lisboa';
  engine.feed(pantalla, 0);
  engine.feed(pantalla, 2000);
  engine.feed(pantalla, 4000);
  await engine.idle();
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith('1.'));
  assert.ok(calls[0].includes('B) París'));
});

test('con varias preguntas en pantalla, cada una se envía al estabilizarse y se revisa si crece', async () => {
  const { engine, calls, events } = makeEngine();
  const q1 = ['1. ¿Capital de Francia?', 'A) Roma', 'B) París', 'C) Berlín', 'D) Lisboa'].join('\n');
  // la segunda solo tiene enunciado y dos opciones (A,B consecutivas = estable)
  const media = q1 + '\n2. ¿Capital de Italia?\nA) Nápoles\nB) Roma';
  engine.feed(media, 0);
  engine.feed(media, 2000);
  engine.feed(media, 4000);
  await engine.idle();
  assert.equal(calls.length, 2);
  assert.ok(calls.some(c => c.includes('París')));
  assert.ok(calls.some(c => c.includes('Nápoles')));

  // se revelan las opciones restantes de la segunda: una revisión con las 4
  const completa2 = q1 + '\n2. ¿Capital de Italia?\nA) Nápoles\nB) Roma\nC) Turín\nD) Milán';
  engine.feed(completa2, 6000);
  engine.feed(completa2, 8000);
  engine.feed(completa2, 10000);
  await engine.idle();
  assert.equal(calls.length, 3);
  assert.ok(calls[2].includes('Turín'));
  const answers = events.filter(e => e.name === 'answer');
  // la pregunta 1 re-detectada re-muestra su caché; la 2 genera la revisión
  assert.equal(answers.length, 4);
  assert.ok(answers.some(a => a.data.fromCache && a.data.item.header.includes('Francia')));
  assert.ok(answers.some(a => a.data.revision && a.data.item.header.includes('Italia')));
});
