// logic.js — motor del pipeline: normalización de OCR, agrupación de preguntas tipo
// test, clasificación, deduplicación y cola de consultas al LLM. Sin DOM: es puro y
// funciona igual en el navegador y en los tests de Node.

export const DEFAULT_CONFIG = {
  ocrPeriodMs: 2000,      // periodo del bucle de OCR (lo usa main.js, no el motor)
  stableReads: 2,         // lecturas consecutivas iguales para dar el texto por estable
  testGraceMs: 4000,      // espera antes de enviar una pregunta sin opciones (las opciones pueden aparecer)
  messageGraceMs: 8000,   // espera antes de descartar un texto que no es pregunta
  groupTimeoutMs: 30000,  // vida máxima de un grupo abierto
  revisionWindowMs: 30000,// ventana para reenviar una pregunta ya respondida si aparecen sus opciones
  sameGroupSim: 0.55,     // similitud mínima para considerar que dos cabeceras son la misma pregunta
  dupSim: 0.9,            // similitud a partir de la cual dos preguntas se consideran duplicadas
  maxPending: 3,          // tareas máximas en cola
  askTimeoutMs: 20000,    // timeout por consulta al LLM
  askRetries: 1,          // reintentos por consulta
  dedupMemory: 25,        // cuántas preguntas recientes recordar para dedup
};

const LETTERS = 'ABCDEFGH';
// confusiones típicas de OCR en letras de opción con delimitador
const LETTER_CONFUSIONS = { '4': 'A', '8': 'B' };

const INTERROGATIVES = new Set([
  'que', 'cual', 'cuales', 'como', 'cuando', 'donde', 'adonde', 'quien', 'quienes',
  'cuanto', 'cuanta', 'cuantos', 'cuantas',
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
]);
const PREPS_FOR_QUE = new Set(['por', 'para', 'en', 'de', 'a', 'con', 'sobre', 'para']);

// ---------------------------------------------------------------------------
// Utilidades de texto
// ---------------------------------------------------------------------------

export function stripAccents(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeForCompare(s) {
  return stripAccents(String(s || '').toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

// Similitud 0..1: máximo entre ratio de Levenshtein (texto corrido) y Jaccard de tokens.
export function similarity(a, b) {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  const la = na.slice(0, 600);
  const lb = nb.slice(0, 600);
  const lev = 1 - levenshtein(la, lb) / Math.max(la.length, lb.length);
  const ta = new Set(la.split(' '));
  const tb = new Set(lb.split(' '));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const jac = inter / (ta.size + tb.size - inter);
  return Math.max(lev, jac);
}

function normContains(hay, needle) {
  const nh = normalizeForCompare(hay);
  const nn = normalizeForCompare(needle);
  return nn.length >= 10 && nh.length >= 10 && nh.includes(nn);
}

// Limpia el OCR crudo: recorta espacios, tira líneas sin contenido alfanumérico y
// une palabras cortadas por guion de fin de línea.
export function normalizeLines(rawText) {
  const out = [];
  for (let raw of String(rawText || '').split(/\r?\n/)) {
    const line = raw.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (!/[a-zA-Z0-9ÁÉÍÓÚÜÑ¿?]/i.test(line)) continue;
    const prev = out[out.length - 1];
    if (prev && /[a-záéíóúüñ]-$/.test(prev) && /^[a-záéíóúüñ]/.test(line)) {
      out[out.length - 1] = prev.slice(0, -1) + line;
    } else {
      out.push(line);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Detección de líneas de opción y de preguntas
// ---------------------------------------------------------------------------

// Opción con delimitador explícito: "A) Venus", "B. Marte", "(C) Mercurio", "D - Tierra", "4) 388"...
export function parseOptionLineStrict(line) {
  const m = String(line).match(/^\(?\s*([A-Ha-h48])\s*[\)\].:\-–—·]\s*(.+)$/);
  if (!m) return null;
  const raw = m[1].toUpperCase();
  const letter = LETTER_CONFUSIONS[raw] || raw;
  const text = m[2].trim();
  if (!text) return null;
  return { letter, text };
}

// Opción con letra suelta: "A 388". Solo candidata: exige que lo que sigue no empiece
// por minúscula (excluye frases tipo "A continuación...") y se valida luego por secuencia.
export function parseOptionLineLoose(line) {
  const m = String(line).match(/^([A-Ha-h])\s+([^\s].*)$/);
  if (!m) return null;
  const text = m[2].trim();
  if (/^[a-záéíóúüñ]/.test(text)) return null;
  return { letter: m[1].toUpperCase(), text };
}

export function isConsecutiveFromA(letters) {
  if (!letters || letters.length < 2) return false;
  const sorted = [...new Set(letters)].sort();
  return sorted.every((l, i) => l === LETTERS[i]);
}

export function isQuestionText(text) {
  const t = String(text || '');
  if (/[?¿]/.test(t)) return true;
  const toks = normalizeForCompare(t).split(' ').filter(Boolean);
  if (!toks.length) return false;
  const first = toks[0];
  if (INTERROGATIVES.has(first)) return true;
  if (PREPS_FOR_QUE.has(first) && toks[1] === 'que') return true;
  return false;
}

// Divide un snapshot del OCR en cabecera (enunciado) y opciones. Las opciones sueltas
// solo se aceptan si la secuencia conjunta es consecutiva desde A.
export function parseSnapshot(lines) {
  const strictOpts = [];
  const looseOpts = [];
  for (const line of lines) {
    const strict = parseOptionLineStrict(line);
    if (strict) { strict._src = line; strictOpts.push(strict); continue; }
    const loose = parseOptionLineLoose(line);
    if (loose) { loose._src = line; looseOpts.push(loose); }
  }
  let options = strictOpts.concat(looseOpts);
  if (!isConsecutiveFromA(options.map(o => o.letter))) {
    options = strictOpts;
  }
  // Una línea en minúscula que sigue a una opción es continuación de su texto
  const optBySrc = new Map(options.map(o => [o._src, o]));
  const finalHeader = [];
  let lastOpt = null;
  for (const line of lines) {
    if (optBySrc.has(line)) { lastOpt = optBySrc.get(line); continue; }
    if (lastOpt && /^[a-záéíóúüñ,(]/.test(line)) {
      lastOpt.text = (lastOpt.text + ' ' + line).trim();
      continue;
    }
    finalHeader.push(line);
    lastOpt = null;
  }
  return {
    headerLines: finalHeader,
    header: finalHeader.join(' '),
    options: options.map(o => ({ letter: o.letter, text: o.text })),
  };
}

// ---------------------------------------------------------------------------
// Construcción del payload y parseo de la respuesta
// ---------------------------------------------------------------------------

export function buildUserPayload(item) {
  let s = String(item.header || '').trim();
  const opts = (item.options || []).slice().sort((a, b) => a.letter.localeCompare(b.letter));
  if (opts.length) s += (s ? '\n\n' : '') + opts.map(o => `${o.letter}) ${o.text}`).join('\n');
  return s;
}

export function parseAnswer(content) {
  const c = String(content || '').trim();
  const a = c.match(/^RESPUESTA\s*:?\s*(.*)$/im);
  const e = c.match(/^EXPLICACI[ÓO]N\s*:?\s*([\s\S]*)$/im);
  const answerLine = a ? a[1].trim() : (c.split('\n')[0] || '').trim();
  let explanation = e ? e[1].trim() : '';
  if (!e && c.includes('\n')) explanation = c.split('\n').slice(1).join('\n').trim();
  return { answerLine, explanation };
}

// ---------------------------------------------------------------------------
// Motor: agrupación + dedup + cola
// ---------------------------------------------------------------------------

export class LogicEngine {
  constructor({ config = {}, llmCall = async () => '', now } = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    this._llmCall = llmCall;
    this._now = now || (() => Date.now());
    this._listeners = {};
    this._group = null;
    this._noDataSince = null;
    this._asked = [];        // [{ text, header, hadOptions, at }] últimas preguntas enviadas
    this._answers = new Map(); // payloadNormalizado -> respuesta
    this._sentPlain = [];    // preguntas simples enviadas, para detectar revisiones
    this._queue = [];
    this._inFlight = null;
    this._lastMessage = '';
  }

  on(name, cb) {
    (this._listeners[name] = this._listeners[name] || []).push(cb);
    return this;
  }

  _emit(name, data) {
    for (const cb of this._listeners[name] || []) {
      try { cb(data); } catch (e) { console.error(e); }
    }
  }

  setLlmCall(fn) { this._llmCall = fn; }

  // ¿Hay una pregunta acumulándose en pantalla ahora mismo?
  hasOpenGroup() {
    return this._group != null;
  }

  // Un ciclo de OCR entrega su texto crudo.
  feed(rawText, now = this._now()) {
    const lines = normalizeLines(rawText);
    if (normalizeForCompare(lines.join(' ')).length < 4) {
      if (this._group && this._noDataSince == null) this._noDataSince = now;
      this._maybeFinalize(now);
      return;
    }
    this._noDataSince = null;
    const snap = parseSnapshot(lines);
    this._ingest(snap, now);
    this._maybeFinalize(now);
  }

  // Reloj: lo llama main.js periódicamente para disparar los temporizadores.
  tick(now = this._now()) {
    this._maybeFinalize(now);
  }

  reset() {
    this._group = null;
    this._noDataSince = null;
    this._asked = [];
    this._answers = new Map();
    this._sentPlain = [];
    this._queue = [];
    this._lastMessage = '';
    this._emit('reset');
  }

  // -- parseo de snapshot ---------------------------------------------------

  _newGroup(snap, now) {
    return {
      headerLines: snap.headerLines.slice(),
      options: new Map(snap.options.map(o => [o.letter, o.text])),
      openedAt: now,
      lastChangeAt: now,
      stableReads: 0,
    };
  }

  _ingest(snap, now) {
    if (!this._group) {
      this._group = this._newGroup(snap, now);
      this._emit('tracking', { header: snap.header, options: snap.options.length });
      return;
    }
    const g = this._group;
    const gHeader = g.headerLines.join(' ');
    const snapOpts = new Set(snap.options.map(o => o.letter));
    const gOpts = new Set(g.options.keys());
    let overlaps = false;
    for (const l of snapOpts) if (gOpts.has(l)) overlaps = true;
    const sameGroup =
      similarity(snap.header, gHeader) >= this.cfg.sameGroupSim ||
      normContains(gHeader, snap.header) ||
      normContains(snap.header, gHeader) ||
      (!snap.header && snap.options.length && overlaps);

    if (!sameGroup) {
      this._finalize(now, 'nueva-pregunta');
      this._group = this._newGroup(snap, now);
      this._emit('tracking', { header: snap.header, options: snap.options.length });
      return;
    }
    this._mergeInto(g, snap, now);
  }

  _mergeInto(g, snap, now) {
    let changed = false;
    const snapH = snap.header;
    const gH = g.headerLines.join(' ');
    if (snapH && normalizeForCompare(snapH).length > normalizeForCompare(gH).length) {
      g.headerLines = snap.headerLines.slice();
      changed = true;
    }
    for (const o of snap.options) {
      const cur = g.options.get(o.letter);
      if (!cur) {
        g.options.set(o.letter, o.text);
        changed = true;
      } else if (normalizeForCompare(o.text).length > normalizeForCompare(cur).length + 1) {
        g.options.set(o.letter, o.text);
        changed = true;
      }
    }
    if (changed) {
      g.lastChangeAt = now;
      g.stableReads = 0;
    } else {
      g.stableReads++;
    }
  }

  // -- finalización ------------------------------------------------------------

  _maybeFinalize(now) {
    const g = this._group;
    if (!g) return;
    const nOpts = g.options.size;
    const letters = [...g.options.keys()];
    const stable = g.stableReads >= this.cfg.stableReads;
    const sinceChange = now - g.lastChangeAt;
    const sinceNoData = this._noDataSince != null ? now - this._noDataSince : 0;
    const header = g.headerLines.join(' ');

    if (nOpts >= 2 && isConsecutiveFromA(letters) && stable) {
      return this._finalize(now, 'test-completo');
    }
    if (nOpts >= 2 && sinceChange >= this.cfg.testGraceMs) {
      return this._finalize(now, 'test-gracia');
    }
    if (nOpts === 0 && isQuestionText(header) && sinceChange >= this.cfg.testGraceMs) {
      return this._finalize(now, 'pregunta-simple');
    }
    if (nOpts === 0 && sinceChange >= this.cfg.messageGraceMs) {
      return this._finalize(now, 'mensaje');
    }
    if (sinceNoData >= this.cfg.messageGraceMs) {
      return this._finalize(now, 'sin-datos');
    }
    if (now - g.openedAt > this.cfg.groupTimeoutMs) {
      return this._finalize(now, 'timeout');
    }
  }

  _finalize(now, reason) {
    const g = this._group;
    this._group = null;
    this._noDataSince = null;
    if (!g) return;
    const options = [...g.options.entries()]
      .map(([letter, text]) => ({ letter, text }))
      .sort((a, b) => a.letter.localeCompare(b.letter));
    const header = g.headerLines.join(' ').trim();
    if (!header && options.length === 0) return;

    const item = { header, options, reason, detectedAt: now };
    if (!isQuestionText(header) && options.length < 2) {
      if (similarity(header, this._lastMessage) < 0.8) {
        this._lastMessage = header;
        this._emit('message', { text: header, at: now });
      }
      return;
    }

    const dup = this._findDup(item, now);
    if (dup) {
      const cached = this._findCachedAnswer(dup.text);
      this._emit('duplicate', { item, hasCached: !!cached });
      if (cached) this._emit('answer', { ...cached, item, fromCache: true });
      return;
    }

    const revision = this._detectRevision(item, now);
    const payload = buildUserPayload(item);
    this._rememberAsked(item, now);
    if (!options.length) this._sentPlain.push({ header, at: now });
    const task = { item, payload, revision, queuedAt: now };
    this._enqueue(task);
  }

  _itemText(item) {
    return normalizeForCompare(buildUserPayload(item));
  }

  _findDup(item, now) {
    const text = this._itemText(item);
    for (const a of this._asked) {
      if (similarity(text, a.text) >= this.cfg.dupSim) return a;
      // excepción: versión con opciones de una pregunta simple recién enviada
      if (
        item.options.length && !a.hadOptions &&
        now - a.at <= this.cfg.revisionWindowMs &&
        similarity(normalizeForCompare(item.header), a.header) >= 0.8
      ) continue;
    }
    return null;
  }

  _detectRevision(item, now) {
    if (!item.options.length) return false;
    for (const p of this._sentPlain) {
      if (now - p.at <= this.cfg.revisionWindowMs && similarity(item.header, p.header) >= 0.8) {
        return true;
      }
    }
    return false;
  }

  _rememberAsked(item, now) {
    this._asked.push({
      text: this._itemText(item),
      header: normalizeForCompare(item.header),
      hadOptions: item.options.length > 0,
      at: now,
    });
    if (this._asked.length > this.cfg.dedupMemory) this._asked.shift();
  }

  _findCachedAnswer(normalizedText) {
    if (this._answers.has(normalizedText)) return this._answers.get(normalizedText);
    for (const [key, val] of this._answers) {
      if (similarity(key, normalizedText) >= this.cfg.dupSim) return val;
    }
    return null;
  }

  // -- cola y consultas ---------------------------------------------------------

  _enqueue(task) {
    this._queue.push(task);
    this._emit('queued', { item: task.item, revision: task.revision });
    while (this._queue.length > this.cfg.maxPending) {
      const dropped = this._queue.shift();
      this._emit('dropped', { item: dropped.item });
    }
    this._pump();
  }

  async _pump() {
    if (this._inFlight || !this._queue.length) return;
    const task = this._queue.shift();
    this._inFlight = task;
    this._emit('asking', { item: task.item, revision: task.revision });
    let lastErr = null;
    for (let attempt = 0; attempt <= this.cfg.askRetries; attempt++) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), this.cfg.askTimeoutMs) : null;
      try {
        const content = await this._llmCall(task.payload, { signal: controller && controller.signal });
        if (timer) clearTimeout(timer);
        const answer = {
          item: task.item,
          content: String(content || '').trim(),
          parsed: parseAnswer(content),
          revision: task.revision,
          at: this._now(),
        };
        this._answers.set(this._itemText(task.item), answer);
        this._emit('answer', answer);
        lastErr = null;
        break;
      } catch (err) {
        if (timer) clearTimeout(timer);
        lastErr = err;
      }
    }
    if (lastErr) {
      this._emit('error', { item: task.item, error: String((lastErr && lastErr.message) || lastErr) });
    }
    this._inFlight = null;
    if (this._queue.length) this._pump();
  }

  // Para tests: espera a que la cola se vacíe.
  idle() {
    return new Promise((resolve) => {
      const check = () => {
        if (!this._inFlight && !this._queue.length) resolve();
        else setTimeout(check, 10);
      };
      check();
    });
  }
}
