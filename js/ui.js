// ui.js — interfaz de control y modo auditorio.
// La respuesta actual domina la pantalla; todas las preguntas respondidas quedan
// en un carril horizontal cronológico: antiguas a la izquierda, nuevas a la derecha.

const $ = (id) => document.getElementById(id);

const board = [];
const MAX_ROWS = 200;

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

function questionLine(item) {
  let header = (item && item.header) || '';
  if (!header && item) header = questionText(item);
  return truncate(String(header).replace(/\s+/g, ' ').trim(), 180);
}

function questionKey(item) {
  return localFp((item && item.header) || questionText(item));
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
  if (board.length) return;
  $('board-empty').hidden = false;
  $('board-empty').textContent = message || 'Escaneando… la primera respuesta aparecerá aquí.';
  $('focus-answer').hidden = true;
}

export function showAnswer(answer) {
  const item = answer.item || {};
  const key = questionKey(item);

  // Una revisión nunca altera lo que ya vio el público. La primera respuesta queda
  // bloqueada incluso si después el OCR descubre C/D u otras opciones.
  if (answer.revision) {
    logEvent(`revisión posterior no mostrada (respuesta bloqueada): ${truncate(item.header, 70)}`);
    return;
  }

  // Reapariciones desde caché no crean tarjetas nuevas.
  if (answer.fromCache && board.some((r) => r.key === key)) return;
  if (board.some((r) => r.key === key)) return;

  const row = {
    key,
    sequence: Number.isFinite(item.sequence) ? item.sequence : board.length,
    question: questionLine(item),
    answerLine: (answer.parsed && answer.parsed.answerLine) || answer.content || '',
    isTest: (item.options || []).length >= 2,
    at: answer.at,
  };

  board.push(row);
  board.sort((a, b) => a.sequence - b.sequence);
  while (board.length > MAX_ROWS) board.shift();

  renderBoard();
  logEvent(`respuesta: ${truncate(row.answerLine, 60)}`);
}

function renderBoard() {
  const rail = $('answer-board');
  const empty = $('board-empty');
  const focus = $('focus-answer');
  const count = $('timeline-count');

  count.textContent = String(board.length);
  empty.hidden = board.length > 0;
  focus.hidden = board.length === 0;
  rail.replaceChildren();

  if (!board.length) return;

  // La pregunta lógicamente más reciente manda, aunque una consulta anterior termine
  // después por la concurrencia del LLM.
  const latest = board[board.length - 1];
  $('focus-question').textContent = latest.question;
  $('focus-value').textContent = latest.answerLine;
  $('focus-meta').textContent = `${latest.isTest ? '🔒 RESPUESTA BLOQUEADA · ' : ''}${hhmmss(latest.at)}`;

  board.forEach((r, i) => {
    const el = document.createElement('article');
    el.className = 'board-row' + (i === board.length - 1 ? ' board-row-new' : '');
    el.dataset.sequence = String(r.sequence);

    const n = document.createElement('span');
    n.className = 'board-n';
    const m = r.question.match(/^\s*(\d{1,3})[.)\-:]\s*/);
    n.textContent = m ? `#${m[1]}` : `#${i + 1}`;

    const q = document.createElement('p');
    q.className = 'board-q';
    q.textContent = r.question;

    const a = document.createElement('p');
    a.className = 'board-a';
    a.textContent = r.answerLine;

    const meta = document.createElement('span');
    meta.className = 'board-meta';
    meta.textContent = (r.isTest ? '🔒 ' : '') + hhmmss(r.at);

    el.append(n, q, a, meta);
    rail.append(el);
  });

  requestAnimationFrame(() => {
    rail.scrollTo({ left: rail.scrollWidth, behavior: 'smooth' });
  });
}

export function clearBoard() {
  board.length = 0;
  renderBoard();
  showWaiting('Sesión nueva. Escaneando…');
}

// La rueda vertical desplaza el carril horizontal: útil con ratón desde la mesa.
const rail = $('answer-board');
rail.addEventListener('wheel', (e) => {
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
  rail.scrollLeft += e.deltaY;
  e.preventDefault();
}, { passive: false });

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
