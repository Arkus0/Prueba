// capture-gate.js — política pura para decidir cuándo lanzar Tesseract.
// En reposo evita OCR continuo; tras un cambio fuerza varias lecturas aunque la
// imagen quede quieta para que LogicEngine pueda confirmar estabilidad.

export class OcrGate {
  constructor({ confirmReads = 3, confirmGapMs = 750, watchdogMs = 10000 } = {}) {
    this.confirmReads = confirmReads;
    this.confirmGapMs = confirmGapMs;
    this.watchdogMs = watchdogMs;
    this.confirmRemaining = 0;
    this.lastRunAt = -Infinity;
  }

  shouldRun({ changed, now, periodMs, hasOpenGroup = false }) {
    if (changed) this.confirmRemaining = Math.max(this.confirmRemaining, this.confirmReads);

    const active = this.confirmRemaining > 0 || hasOpenGroup;
    const gap = active ? Math.min(periodMs, this.confirmGapMs) : periodMs;
    const elapsed = now - this.lastRunAt;
    const watchdogDue = elapsed >= this.watchdogMs;

    return elapsed >= gap && (changed || active || watchdogDue);
  }

  markRun(now) {
    this.lastRunAt = now;
    if (this.confirmRemaining > 0) this.confirmRemaining -= 1;
  }

  reset() {
    this.confirmRemaining = 0;
    this.lastRunAt = -Infinity;
  }
}
