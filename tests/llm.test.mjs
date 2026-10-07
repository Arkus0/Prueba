import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, llmCall } from '../js/llm.js';

test('defaults: OpenRouter + Claude Sonnet 5.5 + reasoning high', () => {
  assert.equal(DEFAULT_SETTINGS.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(DEFAULT_SETTINGS.model, 'anthropic/claude-sonnet-5.5');
  assert.equal(DEFAULT_SETTINGS.reasoningEffort, 'high');
  assert.equal(DEFAULT_SETTINGS.maxTokens, 1200);
});

test('llmCall envía reasoning.effort a OpenRouter', async () => {
  const oldFetch = globalThis.fetch;
  let body = null;
  globalThis.fetch = async (_url, opts) => {
    body = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'RESPUESTA: B) Kant' } }] }),
    };
  };
  try {
    const out = await llmCall('¿Quién escribió la Crítica?', {
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test', reasoningEffort: 'high' },
    });
    assert.equal(out, 'RESPUESTA: B) Kant');
    assert.deepEqual(body.reasoning, { effort: 'high' });
    assert.equal(body.model, 'anthropic/claude-sonnet-5.5');
  } finally {
    globalThis.fetch = oldFetch;
  }
});
