// logic.js — motor del pipeline: normalización de OCR, agrupación de preguntas tipo
// test (incluidas varias preguntas visibles a la vez), clasificación, deduplicación
// con estados (pendiente/respondida/fallada/descartada) y cola de consultas al LLM.
// Sin DOM: es puro y funciona igual en el navegador y en los tests de Node.

export const DEFAULT_CONFIG = {
  ocrPeriodMs: 1500,      // periodo del bucle de OCR (lo usa main.js, no el motor)
  stableReads: 2,         // lecturas consecutivas iguales para dar el texto por estable
  testGraceMs: 4000,      // espera antes de enviar una pregunta sin opciones (las opciones pueden aparecer)
  messageGraceMs: 8000,   // espera antes de descartar un texto que no es pregunta
  groupTimeoutMs: 30000,  // vida máxima de un grupo abierto
  revisionWindowMs: 30000,// ventana para reenviar una pregunta ya respondida si aparecen sus opciones
  sameGroupSim: 0.55,     // similitud mínima para considerar que dos cabeceras son la misma pregunta
  sameGroupSimPlain: 0.92, // umbral más estricto cuando ambas preguntas no tienen opciones
  dupSim: 0.9,            // similitud a partir de la cual dos preguntas se consideran duplicadas
  maxPending: 8,          // tareas máximas en cola (varias preguntas pueden verse a la vez)
  maxConcurrent: 2,       // consultas al LLM simultáneas
  askTimeoutMs: 10000,    // timeout por consulta al LLM
  askRetries: 1,          // reintentos por consulta
  dedupMemory: 25,        // cuántas preguntas recientes recordar para dedup
  confHigh: 75,           // confianza OCR por debajo de la cual se exige estabilidad estricta
  confLow: 55,            // confianza OCR por debajo de la cual se congela la finalización
};

const LETTERS = 'ABCDEFGH';
// confusiones típicas de OCR en letras de opción con delimitador
const LETTER_CONFUSIONS = { '4': 'A', '8': 'B' };

const INTERROGATIVES = new Set([
  'que', 'cual', 'cuales', 'como', 'cuando', 'donde', 'adonde', 'quien', 'quienes',
  'cuanto', 'cuanta', 'cuantos', 'cuantas',
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
]);
const PREPS_FOR_QUE = new Set(['por', 'para', 'en', 'de', 'a', 'con', 'sobre']);

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
// ruido de interfaz, y une palabras cortadas por guion de fin de línea.
export function normalizeLines(rawText) {
  const out = [];
  for (let raw of String(rawText || '').split(/\r?\n/)) {
    const line = raw.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (!/[a-zA-Z0-9ÁÉÍÓÚÜÑ¿?]/i.test(line)) continue;
    if (isNoiseLine(line)) continue;
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

// ¿La línea empieza por interrogación (sirve para partir preguntas apiladas)?
function startsInterrogatively(line) {
  const t = String(line).trim();
  if (t.startsWith('¿') || t.startsWith('(')) return true;
  const toks = normalizeForCompare(t).split(' ').filter(Boolean);
  if (!toks.length) return false;
  return INTERROGATIVES.has(toks[0]) || (PREPS_FOR_QUE.has(toks[0]) && toks[1] === 'que');
}

// Arranque numerado de pregunta: "1. ¿...?", "2) ...", "Pregunta 3 - ..."
const NUMBERED_START = /^\(?\s*(?:pregunta\s*)?(\d{1,2})\s*[\).\:\-–—]\s+(.+)$/i;

// Número inicial de un enunciado ("1.", "2)") o null si no está numerado.
function leadingNumber(text) {
  const m = String(text || '').match(/^\(?\s*(?:pregunta\s*)?(\d{1,2})\s*[\).\:\-–—]\s+/i);
  return m ? m[1] : null;
}

// Línea de instrucción típica de formularios ("Seleccione la respuesta adecuada").
const INSTRUCTION_RE = /^(seleccione|selecciona|elige|elija|escoge|escribe|marca|responde|indica|choose|select)\b/i;
function isInstructionLine(line) {
  return INSTRUCTION_RE.test(String(line).trim());
}

// Ruido de interfaz: relojes, barras de navegador y dominios sueltos.
function isNoiseLine(line) {
  const t = String(line).trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) return true;
  if (/[?¿]/.test(t) || t.length >= 60) return false;
  if (/\b(https?:\/\/|www\.)\S+/i.test(t)) return true;
  if (/^\S+\.(com|es|org|net|edu)\b/i.test(t)) return true;
  return false;
}

// ¿La línea es el arranque numerado de una pregunta?
// Acepta interrogativas y también enunciados declarativos de examen:
// "3. La concepción heideggeriana del Dasein se caracteriza por:".
function isNumberedQuestionStart(line) {
  const m = String(line).match(NUMBERED_START);
  if (!m) return false;
  const body = String(m[2] || '').trim();
  if (isQuestionText(body)) return true;
  const words = normalizeForCompare(body).split(' ').filter(Boolean);
  return body.length >= 18 && words.length >= 4;
}

function classifyLine(line) {
  // un arranque numerado de pregunta nunca es una opción (evita p.ej. "4." → "A")
  if (isNumberedQuestionStart(line)) return { line, kind: 'header', numbered: true };
  const strict = parseOptionLineStrict(line);
  if (strict) return { line, kind: 'option', opt: strict, strict: true };
  const loose = parseOptionLineLoose(line);
  if (loose) return { line, kind: 'option', opt: loose, strict: false };
  return { line, kind: 'header' };
}

// ¿Esta línea arranca una pregunta nueva distinta de la que se está acumulando?
function startsNewQuestion(line, cur) {
  const hasOpts = cur.some((i) => i.kind === 'option');
  if (hasOpts) {
    if (isNumberedQuestionStart(line)) return true;
    return isQuestionText(line) && normalizeForCompare(line).length >= 8;
  }
  // sin opciones aún: parted sólo si la cabecera acumulada ya es una pregunta
  // COMPLETA (termina en ?) y la nueva línea arranca interrogativamente
  const headerLines = cur.filter((i) => i.kind === 'header').map((i) => i.line);
  const prev = headerLines[headerLines.length - 1] || '';
  return (
    /[?¿]\s*$/.test(prev) &&
    startsInterrogatively(line) &&
    normalizeForCompare(line).length >= 8
  );
}

// Parte un snapshot del OCR en bloques de pregunta: cabecera + opciones. Soporta
// varias preguntas visibles a la vez. Con varias preguntas numeradas usa análisis
// por bloques que sintetiza letras para opciones que llegan sin ellas.
export function segmentSnapshot(lines) {
  const numberedAt = [];
  lines.forEach((line, i) => {
    if (isNumberedQuestionStart(line)) numberedAt.push(i);
  });
  if (numberedAt.length >= 2) {
    const segments = [];
    const pre = lines.slice(0, numberedAt[0]);
    if (pre.length) segments.push(...legacySegment(pre));
    for (let k = 0; k < numberedAt.length; k++) {
      const end = k + 1 < numberedAt.length ? numberedAt[k + 1] : lines.length;
      segments.push(parseNumberedBlock(lines.slice(numberedAt[k], end)));
    }
    return segments.filter((s) => s.header || s.options.length);
  }
  return legacySegment(lines);
}

// Segmentación por heurísticas de contenido (preguntas apiladas sin numerar).
function legacySegment(lines) {
  const segments = [];
  let cur = [];
  const close = () => {
    if (cur.length) segments.push(cur);
    cur = [];
  };
  for (const line of lines) {
    const c = classifyLine(line);
    if (c.kind === 'option') {
      // reaparece la letra A habiendo opciones: empieza otra pregunta
      if (c.opt.letter === 'A' && cur.some((i) => i.kind === 'option')) close();
      cur.push(c);
    } else if (startsNewQuestion(line, cur)) {
      close();
      cur.push(c);
    } else {
      cur.push(c);
    }
  }
  close();
  return segments.filter(Boolean).map(buildSegment).filter((s) => s.header || s.options.length);
}

// Analiza el bloque de una pregunta numerada: enunciado, línea de instrucción como
// separador y zona de opciones donde las líneas sin letra reciben letras sintéticas
// consecutivas a partir de la última letra real vista.
function parseNumberedBlock(lines) {
  const cls = lines.map(classifyLine);
  // separador de la zona de opciones: última línea de instrucción o primera opción con letra
  let cut = -1;
  for (let i = 1; i < cls.length; i++) {
    if (isInstructionLine(cls[i].line)) cut = i;
  }
  if (cut < 0) {
    for (let i = 1; i < cls.length; i++) {
      if (cls[i].kind === 'option') { cut = i; break; }
    }
  }
  if (cut < 0) {
    // sin separador: cola final de líneas cortas no interrogativas como opciones
    let runStart = cls.length;
    for (let i = cls.length - 1; i >= 1; i--) {
      const l = cls[i].line;
      if (isQuestionText(l) || l.length > 100 || isInstructionLine(l)) break;
      runStart = i;
    }
    if (cls.length - runStart >= 2) cut = runStart;
  }
  const headerItems = cut >= 1 ? cls.slice(0, cut) : cls;
  const optionItems = cut >= 1 ? cls.slice(cut) : [];

  const headerLines = headerItems
    .filter((i) => !isInstructionLine(i.line))
    .map((i) => i.line);
  const options = [];
  let next = 0;
  for (const it of optionItems) {
    if (isInstructionLine(it.line)) continue;
    if (it.kind === 'option') {
      options.push({ letter: it.opt.letter, text: it.opt.text });
      const idx = LETTERS.indexOf(it.opt.letter);
      if (idx >= 0) next = Math.max(next, idx + 1);
    } else if (next < LETTERS.length) {
      options.push({ letter: LETTERS[next], text: it.line });
      next++;
    }
  }
  return { headerLines, header: headerLines.join(' '), options };
}

// Convierte las líneas clasificadas de un bloque en { headerLines, header, options },
// validando las opciones sueltas por secuencia y uniendo continuaciones en minúscula.
function buildSegment(items) {
  const strictOpts = items.filter((i) => i.kind === 'option' && i.strict);
  const looseOpts = items.filter((i) => i.kind === 'option' && !i.strict);
  const useLoose = isConsecutiveFromA(strictOpts.concat(looseOpts).map((i) => i.opt.letter));
  const active = useLoose ? strictOpts.concat(looseOpts) : strictOpts;
  const activeLines = new Set(active.map((i) => i.line));

  const headerLines = [];
  let lastOpt = null;
  for (const it of items) {
    if (it.kind === 'option' && activeLines.has(it.line)) {
      lastOpt = it.opt;
      continue;
    }
    if (lastOpt && /^[a-záéíóúüñ,(]/.test(it.line)) {
      lastOpt.text = (lastOpt.text + ' ' + it.line).trim();
      continue;
    }
    headerLines.push(it.line);
    lastOpt = null;
  }
  const options = active.map((i) => ({ letter: i.opt.letter, text: i.opt.text }))
    .sort((a, b) => a.letter.localeCompare(b.letter));
  return { headerLines, header: headerLines.join(' '), options };
}

// Comodidad para el caso de una sola pregunta (compatible con usos anteriores).
export function parseSnapshot(lines) {
  return segmentSnapshot(lines)[0] || { headerLines: [], header: '', options: [] };
}

// ---------------------------------------------------------------------------
// Construcción del payload y parseo de la respuesta
// ---------------------------------------------------------------------------

export function buildUserPayload(item) {
  let s = String(item.header || '').trim();
  const opts = (item.options || []).slice().sort((a, b) => a.letter.localeCompare(b.letter));
  if (opts.length) s += (s ? '\n\n' : '') + opts.map((o) => `${o.letter}) ${o.text}`).join('\n');
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
// Motor: agrupación + dedup con estados + cola
// ---------------------------------------------------------------------------

// El texto ganador de unas votaciones: el más visto; a igualdad, el más largo.
function bestOf(votes) {
  let best = null;
  let bestN = -1;
  let bestLen = -1;
  for (const [text, n] of votes) {
    const len = normalizeForCompare(text).length;
    if (n > bestN || (n === bestN && len > bestLen)) {
      best = text;
      bestN = n;
      bestLen = len;
    }
  }
  return best || '';
}

export class LogicEngine {
  constructor({ config = {}, llmCall = async () => '', now } = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    this._llmCall = llmCall;
    this._now = now || (() => Date.now());
    this._listeners = {};
    this._sessionId = 0;
    this._sequence = 0;
    this._groups = [];        // preguntas abiertas en pantalla (puede haber varias)
    this._noDataSince = null;
    this._asked = [];         // [{ text, header, nOptions, at, state }]
    this._answers = new Map(); // payloadNormalizado -> respuesta
    this._queue = [];
    this._inFlight = new Set(); // tareas en vuelo (con .controller abortable)
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

  // ¿Hay alguna pregunta acumulándose en pantalla ahora mismo?
  hasOpenGroup() {
    return this._groups.length > 0;
  }

  // Un ciclo de OCR entrega su texto crudo y (opcional) su confianza 0-100.
  feed(rawText, now = this._now(), confidence) {
    const lines = normalizeLines(rawText);
    if (normalizeForCompare(lines.join(' ')).length < 4) {
      if (this._groups.length && this._noDataSince == null) this._noDataSince = now;
      this._maybeFinalize(now);
      return;
    }
    this._noDataSince = null;

    // Una lectura globalmente mala no debe votar en el consenso ni crear grupos.
    // Si ya había una pregunta abierta, la deja congelada hasta una lectura mejor.
    if (confidence != null && confidence < this.cfg.confLow) {
      for (const g of this._groups) {
        g.lastConf = confidence;
        g.stableReads = 0;
        g.lastChangeAt = now;
      }
      this._emit('lowConfidence', { confidence, at: now });
      return;
    }

    const segments = segmentSnapshot(lines);
    for (const seg of segments) this._ingestSegment(seg, now, confidence);
    this._maybeFinalize(now);
  }

  // Reloj: lo llama main.js periódicamente para disparar los temporizadores.
  tick(now = this._now()) {
    this._maybeFinalize(now);
  }

  // Reinicia la sesión abortando consultas en vuelo y descartando sus resultados.
  reset() {
    this._sessionId += 1;
    this._sequence = 0;
    for (const task of this._inFlight) {
      if (task.controller) task.controller.abort();
    }
    this._groups = [];
    this._noDataSince = null;
    this._asked = [];
    this._answers = new Map();
    this._queue = [];
    this._lastMessage = '';
    this._emit('reset');
  }

  // -- agrupación ------------------------------------------------------------

  _newGroup(snap, now, confidence) {
    const g = {
      headerVotes: new Map(),
      options: new Map(), // letter -> { votes: Map<text, n> }
      openedAt: now,
      lastChangeAt: now,
      stableReads: 0,
      lastConf: confidence != null ? confidence : null,
    };
    if (snap.header) g.headerVotes.set(snap.header, 1);
    for (const o of snap.options) {
      g.options.set(o.letter, { votes: new Map([[o.text, 1]]) });
    }
    return g;
  }

  _groupHeader(g) {
    return bestOf(g.headerVotes);
  }

  _matchGroup(seg) {
    const segNum = leadingNumber(seg.header);
    const bothPlain = seg.options.length === 0;
    let best = null;
    let bestScore = this.cfg.sameGroupSim - 0.001;
    for (const g of this._groups) {
      const gHeader = this._groupHeader(g);
      // dos preguntas SIN opciones solo se consideran la misma si se parecen mucho
      const threshold = bothPlain && g.options.size === 0
        ? Math.max(this.cfg.sameGroupSim, this.cfg.sameGroupSimPlain)
        : this.cfg.sameGroupSim;
      // enunciados numerados con número distinto: preguntas distintas, no fusionar
      const gNum = leadingNumber(gHeader);
      if (segNum && gNum && segNum !== gNum) continue;
      let score = similarity(seg.header, gHeader);
      if (normContains(gHeader, seg.header) || normContains(seg.header, gHeader)) {
        score = Math.max(score, 0.9);
      }
      if (!seg.header && seg.options.length) {
        let overlap = false;
        for (const o of seg.options) if (g.options.has(o.letter)) overlap = true;
        if (overlap) score = Math.max(score, 0.7);
      }
      if (score >= threshold && score > bestScore) {
        bestScore = score;
        best = g;
      }
    }
    return best;
  }

  _ingestSegment(seg, now, confidence) {
    const g = this._matchGroup(seg);
    if (!g) {
      this._groups.push(this._newGroup(seg, now, confidence));
      this._emit('tracking', { header: seg.header, options: seg.options.length });
      return;
    }
    this._mergeInto(g, seg, now, confidence);
  }

  // Consenso por votación: cada lectura suma un voto a los textos vistos y gana el
  // más votado (a igualdad, el más largo). Así "Kant → Kani → Kant" acaba en "Kant".
  _mergeInto(g, snap, now, confidence) {
    const prevHeader = this._groupHeader(g);
    const prevBests = new Map();
    for (const [letter, v] of g.options) prevBests.set(letter, bestOf(v.votes));

    if (snap.header) g.headerVotes.set(snap.header, (g.headerVotes.get(snap.header) || 0) + 1);
    for (const o of snap.options) {
      let v = g.options.get(o.letter);
      if (!v) {
        v = { votes: new Map() };
        g.options.set(o.letter, v);
      }
      v.votes.set(o.text, (v.votes.get(o.text) || 0) + 1);
    }

    let changed = this._groupHeader(g) !== prevHeader;
    for (const [letter, v] of g.options) {
      const nowBest = bestOf(v.votes);
      if (nowBest !== prevBests.get(letter)) changed = true;
    }
    if ([...g.options.keys()].some((l) => !prevBests.has(l))) changed = true;

    if (confidence != null) g.lastConf = confidence;

    if (confidence != null && confidence < this.cfg.confLow) {
      // lectura poco fiable: actualiza contenido pero congela la finalización
      g.stableReads = 0;
      g.lastChangeAt = now;
    } else if (changed) {
      g.lastChangeAt = now;
      g.stableReads = 0;
    } else {
      g.stableReads++;
    }
  }

  // -- finalización ------------------------------------------------------------

  _maybeFinalize(now) {
    for (const g of [...this._groups]) {
      // Nunca finalizar por timeout una lectura que el propio OCR considera mala.
      if (g.lastConf != null && g.lastConf < this.cfg.confLow) continue;

      const nOpts = g.options.size;
      const letters = [...g.options.keys()];
      const stable = g.stableReads >= this.cfg.stableReads;
      // con confianza media se exige estabilidad real; el reloj solo es emergencia
      const minStable = g.lastConf != null && g.lastConf < this.cfg.confHigh
        ? this.cfg.stableReads
        : 1;
      const sinceChange = now - g.lastChangeAt;
      const sinceNoData = this._noDataSince != null ? now - this._noDataSince : 0;
      const header = this._groupHeader(g);

      if (nOpts >= 4 && isConsecutiveFromA(letters) && stable) {
        this._finalizeGroup(g, now, 'test-completo');
      } else if (nOpts >= 2 && sinceChange >= this.cfg.testGraceMs && g.stableReads >= minStable) {
        this._finalizeGroup(g, now, 'test-gracia');
      } else if (nOpts === 0 && isQuestionText(header) && sinceChange >= this.cfg.testGraceMs && g.stableReads >= minStable) {
        this._finalizeGroup(g, now, 'pregunta-simple');
      } else if (nOpts === 0 && !isQuestionText(header) && sinceChange >= this.cfg.messageGraceMs) {
        // solo para textos que no son pregunta: una pregunta poco fiable sigue
        // esperando (la envía el timeout de emergencia o una lectura mejor)
        this._finalizeGroup(g, now, 'mensaje');
      } else if (sinceNoData >= this.cfg.messageGraceMs) {
        this._finalizeGroup(g, now, 'sin-datos');
      } else if (now - g.openedAt > this.cfg.groupTimeoutMs) {
        this._finalizeGroup(g, now, 'timeout');
      }
    }
  }

  _finalizeGroup(g, now, reason) {
    const idx = this._groups.indexOf(g);
    if (idx >= 0) this._groups.splice(idx, 1);
    if (!this._groups.length) this._noDataSince = null;

    const options = [...g.options.entries()]
      .map(([letter, v]) => ({ letter, text: bestOf(v.votes) }))
      .sort((a, b) => a.letter.localeCompare(b.letter));
    const header = this._groupHeader(g).trim();
    if (!header && options.length === 0) return;

    const item = { header, options, reason, detectedAt: now, sequence: this._sequence++ };
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
      this._emit('duplicate', { item, hasCached: !!cached, state: dup.state });
      if (cached) this._emit('answer', { ...cached, item, fromCache: true });
      return;
    }

    const revision = this._detectRevision(item, now);
    const payload = buildUserPayload(item);
    const entry = this._rememberAsked(item, now);
    const task = { item, payload, revision, queuedAt: now, sessionId: this._sessionId, entry };
    this._enqueue(task);
  }

  _itemText(item) {
    return normalizeForCompare(buildUserPayload(item));
  }

  // Una pregunta solo cuenta como "ya vista" si está pendiente o respondida;
  // las falladas o descartadas por cola llena se pueden reintentar.
  _findDup(item, now) {
    const text = this._itemText(item);
    const iNum = leadingNumber(item.header);
    for (const a of this._asked) {
      if (a.state === 'failed' || a.state === 'dropped') continue;
      // preguntas numeradas con número distinto: jamás la misma pregunta,
      // aunque compartan enunciado corto y opciones idénticas
      if (iNum && a.num && iNum !== a.num) continue;
      // la excepción de revisión (han aparecido más opciones) se comprueba ANTES
      // del corte por similitud, o la nueva versión se perdería como duplicado
      if (
        item.options.length > a.nOptions &&
        now - a.at <= this.cfg.revisionWindowMs &&
        similarity(normalizeForCompare(item.header), a.header) >= 0.8
      ) continue;
      if (similarity(text, a.text) >= this.cfg.dupSim) return a;
    }
    return null;
  }

  _detectRevision(item, now) {
    if (!item.options.length) return false;
    const iNum = leadingNumber(item.header);
    for (const a of this._asked) {
      if (a.state === 'failed' || a.state === 'dropped') continue;
      if (iNum && a.num && iNum !== a.num) continue;
      if (
        now - a.at <= this.cfg.revisionWindowMs &&
        item.options.length > a.nOptions &&
        similarity(normalizeForCompare(item.header), a.header) >= 0.8
      ) {
        return true;
      }
    }
    return false;
  }

  _rememberAsked(item, now) {
    const entry = {
      text: this._itemText(item),
      header: normalizeForCompare(item.header),
      num: leadingNumber(item.header),
      nOptions: item.options.length,
      at: now,
      state: 'pending',
    };
    this._asked.push(entry);
    if (this._asked.length > this.cfg.dedupMemory) this._asked.shift();
    return entry;
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
      dropped.entry.state = 'dropped'; // podrá reintentarse si reaparece
      this._emit('dropped', { item: dropped.item });
    }
    this._pump();
  }

  _pump() {
    while (this._inFlight.size < this.cfg.maxConcurrent && this._queue.length) {
      const task = this._queue.shift();
      if (task.sessionId !== this._sessionId) continue; // sesión reiniciada: fuera
      this._runTask(task);
    }
  }

  async _runTask(task) {
    this._inFlight.add(task);
    this._emit('asking', { item: task.item, revision: task.revision });
    let lastErr = null;
    for (let attempt = 0; attempt <= this.cfg.askRetries; attempt++) {
      if (task.sessionId !== this._sessionId) break; // abortada por reset
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      task.controller = controller;
      const timer = controller ? setTimeout(() => controller.abort(), this.cfg.askTimeoutMs) : null;
      try {
        const content = await this._llmCall(task.payload, { signal: controller && controller.signal });
        if (timer) clearTimeout(timer);
        if (task.sessionId !== this._sessionId) break; // la respuesta es de otra sesión
        const answer = {
          item: task.item,
          content: String(content || '').trim(),
          parsed: parseAnswer(content),
          revision: task.revision,
          at: this._now(),
        };
        task.entry.state = 'answered';
        this._answers.set(this._itemText(task.item), answer);
        this._emit('answer', answer);
        lastErr = null;
        break;
      } catch (err) {
        if (timer) clearTimeout(timer);
        lastErr = err;
      }
    }
    if (lastErr && task.sessionId === this._sessionId) {
      task.entry.state = 'failed'; // podrá reintentarse si la pregunta reaparece
      this._emit('error', { item: task.item, error: String((lastErr && lastErr.message) || lastErr) });
    }
    this._inFlight.delete(task);
    if (this._queue.length) this._pump();
  }

  // Para tests: espera a que la cola se vacíe.
  idle() {
    return new Promise((resolve) => {
      const check = () => {
        if (!this._inFlight.size && !this._queue.length) resolve();
        else setTimeout(check, 10);
      };
      check();
    });
  }
}
