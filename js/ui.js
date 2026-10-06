// ui.js — render puro de la interfaz: estado, tarjeta de respuesta, historial y
// panel de depuración. No contiene lógica del pipeline.

const $ = (id) => document.getElementById(id);

export function setStatus(text, kind = 'idle') {
  const chip = $('status-chip');
  chip.textContent = text;
  chip.className = `chip chip-${kind}`;
}

export function questionText(item) {
  if (!item) return '';
  const opts = (item.options || []).map((o) => `${o.letter}) ${o.text}`).join('\n');
  return opts ? `${item.header || ''}\n${opts}`.trim() : (item.header || '');
}

export function showWaiting(message) {
  $('answer-card').classList.remove('answered');
  $('answer-card').classList.add('waiting');
  $('card-body').hidden = true;
  $('card-waiting').hidden = false;
  $('card-waiting').textContent = message || 'Escaneando… aparecerá aquí la respuesta a la primera pregunta detectada.';
}

export function showAnswer(answer) {
  const card = $('answer-card');
  card.classList.remove('waiting');
  card.classList.add('answered');
  $('card-waiting').hidden = true;
  $('card-body').hidden = false;

  $('card-question').textContent = questionText(answer.item);
  $('card-answer-value').textContent = (answer.parsed && answer.parsed.answerLine) || answer.content || '';
  const expl = (answer.parsed && answer.parsed.explanation) || '';
  $('card-expl-value').textContent = expl;
  $('card-expl').style.display = expl ? '' : 'none';

  const meta = [];
  if (answer.revision) meta.push('actualizada con opciones');
  if (answer.fromCache) meta.push('desde caché');
  meta.push(hhmmss(answer.at));
  $('card-meta').textContent = meta.join(' · ');

  if (!answer.fromCache) addHistory(answer);
}

function addHistory(answer) {
  const list = $('history');
  const empty = $('history-empty');
  if (empty) empty.remove();
  const li = document.createElement('li');
  li.className = 'history-item';
  const q = document.createElement('p');
  q.className = 'h-q';
  q.textContent = questionText(answer.item);
  const a = document.createElement('p');
  a.className = 'h-a';
  a.textContent = (answer.parsed && answer.parsed.answerLine) || answer.content || '';
  const e = document.createElement('p');
  e.className = 'h-e';
  e.textContent = (answer.parsed && answer.parsed.explanation) || '';
  li.append(q, a);
  if (e.textContent) li.append(e);
  list.prepend(li);
  while (list.children.length > 5) list.lastChild.remove();
}

export function clearHistory() {
  const list = $('history');
  list.replaceChildren();
  const li = document.createElement('li');
  li.className = 'history-empty';
  li.id = 'history-empty';
  li.textContent = 'Aún no hay respuestas en esta sesión.';
  list.append(li);
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
