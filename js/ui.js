// ui.js — render de la interfaz: estado, marcador de respuestas y panel de
// depuración. No contiene lógica del pipeline.

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Marcador: últimas respuestas visibles a la vez, la última en grande
// ---------------------------------------------------------------------------

const board = []; // filas mostradas (se conservan las últimas 12, se pintan 4)

function localFp(text) {
  return String(text || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// El enunciado en una línea (sin las opciones: la respuesta ya muestra la elegida)
function questionLine(item) {
  let header = (item && item.header) || '';
  if (!header && item) header = questionText(item);
  return truncate(String(header).replace(/\s+/g, ' ').trim(), 110);
}

export function questionText(item) {
  if (!item) return '';
  const opts = (item.options || []).map((o) => `${o.letter}) ${o.text}`).join('\n');
  return opts ? `${item.header || ''}\n${opts}`.trim() : (item.header || '');
}

export function setStatus(text, kind = 'idle') {
  const chip = $('status-chip');
  chip.textContent = text;
  chip.className = `chip chip-${kind}`;
}

export function showWaiting(message) {
  $('board-empty').hidden = false;
  $('board-empty').textContent = message || 'Escaneando… las respuestas aparecerán aquí: la última en grande y las anteriores debajo.';
}

export function showAnswer(answer) {
  const item = answer.item || {};
  const row = {
    fp: localFp(questionText(item)),
    question: questionLine(item),
    answerLine: (answer.parsed && answer.parsed.answerLine) || answer.content || '',
    isTest: (item.options || []).length >= 2,
    revision: !!answer.revision,
    at: answer.at,
  };
  // una respuesta en caché que ya está en el marcador no duplica fila
  if (answer.fromCache && board.some((r) => r.fp === row.fp)) return;
  board.push(row);
  while (board.length > 12) board.shift();
  renderBoard();
  if (!answer.fromCache) addReview(row);
  logEvent(`respuesta: ${truncate(row.answerLine, 60)}`);
}

// Lista completa de la sesión para el repaso final (no desaparece nada)
const review = [];

function addReview(row) {
  review.push(row);
  if (review.length > 200) review.shift();
  renderReview();
}

function renderReview() {
  const list = $('review-list');
  $('review-count').textContent = String(review.length);
  list.hidden = review.length === 0;
  list.replaceChildren();
  [...review].reverse().forEach((r) => {
    const li = document.createElement('li');
    const q = document.createElement('span');
    q.className = 'review-q';
    q.textContent = (r.revision ? '↻ ' : '') + r.question;
    const a = document.createElement('span');
    a.className = 'review-a';
    a.textContent = r.answerLine;
    li.append(q, a);
    list.append(li);
  });
}

function renderBoard() {
  const cont = $('answer-board');
  $('board-empty').hidden = board.length > 0;
  cont.replaceChildren();
  const visible = board.slice(-4).reverse(); // la más reciente arriba
  visible.forEach((r, i) => {
    const el = document.createElement('article');
    el.className = 'board-row' + (i === 0 ? ' board-row-new' : '');
    el.dataset.pos = String(i);

    const q = document.createElement('p');
    q.className = 'board-q';
    q.textContent = (r.revision ? '↻ ' : '') + r.question;

    const a = document.createElement('p');
    a.className = 'board-a';
    a.textContent = r.answerLine;

    const meta = document.createElement('span');
    meta.className = 'board-meta';
    meta.textContent = (r.isTest ? '🔒 ' : '') + hhmmss(r.at);

    el.append(q, a, meta);
    cont.append(el);
  });
}

export function clearBoard() {
  board.length = 0;
  review.length = 0;
  renderBoard();
  renderReview();
  showWaiting('Sesión nueva. Escaneando…');
}

// ---------- depuración ----------

export function setRawOcr(text, confidence) {
  $('raw-ocr').textContent = text || '(sin texto)';
  $('ocr-conf').textContent = confidence != null ? `· confianza ${Math.round(confidence)}%` : '';
}

export function logEvent(line) {
  const list = $('event-log');
  const li = document.createElement('li');
  li.textContent = `${hhmmss(Date.now())} — ${line}`;
  list.prepend(li);
  while (list.children.length > 50) list.lastChild.remove();
}

function hhmmss(ts) {
  const d = new Date(ts || Date.now());
  return d.toLocaleTimeString('es', { hour12: false });
}
