import test from 'node:test';
import assert from 'node:assert/strict';
import { OcrGate } from '../js/capture-gate.js';

test('un cambio fuerza tres OCR aunque la imagen quede quieta', () => {
  const g = new OcrGate({ confirmReads: 3, confirmGapMs: 750, watchdogMs: 10000 });
  assert.equal(g.shouldRun({ changed: true, now: 0, periodMs: 1500 }), true);
  g.markRun(0);
  assert.equal(g.shouldRun({ changed: false, now: 500, periodMs: 1500 }), false);
  assert.equal(g.shouldRun({ changed: false, now: 750, periodMs: 1500 }), true);
  g.markRun(750);
  assert.equal(g.shouldRun({ changed: false, now: 1500, periodMs: 1500 }), true);
  g.markRun(1500);
  assert.equal(g.confirmRemaining, 0);
  assert.equal(g.shouldRun({ changed: false, now: 2250, periodMs: 1500 }), false);
});

test('una pregunta abierta mantiene OCR de confirmación hasta finalizar', () => {
  const g = new OcrGate({ confirmReads: 1, confirmGapMs: 700, watchdogMs: 10000 });
  assert.equal(g.shouldRun({ changed: true, now: 0, periodMs: 1500 }), true);
  g.markRun(0);
  assert.equal(g.shouldRun({ changed: false, now: 700, periodMs: 1500, hasOpenGroup: true }), true);
  g.markRun(700);
  assert.equal(g.shouldRun({ changed: false, now: 1400, periodMs: 1500, hasOpenGroup: true }), true);
});

test('en reposo el watchdog produce una lectura ocasional', () => {
  const g = new OcrGate({ watchdogMs: 10000 });
  assert.equal(g.shouldRun({ changed: true, now: 0, periodMs: 1500 }), true);
  g.markRun(0);
  g.confirmRemaining = 0;
  assert.equal(g.shouldRun({ changed: false, now: 9000, periodMs: 1500 }), false);
  assert.equal(g.shouldRun({ changed: false, now: 10000, periodMs: 1500 }), true);
});
