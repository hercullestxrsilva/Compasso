import { afterEach, describe, expect, it } from 'vitest';
import { createApp, findEvidence, foldForMatch, timestampBefore } from '../server/app.mjs';
import { resolve } from 'node:path';
const servers = [];
async function app(options) {
  const server = await createApp(options);
  servers.push(server);
  return server;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => s.close()));
});
const local = { ALLOW_LOCAL_AI: 'true', OPENAI_API_KEY: 'test-key' };
function review(tasks, questions = []) {
  return new Response(
    JSON.stringify({
      status: 'completed',
      output: [
        {
          content: [{ type: 'output_text', text: JSON.stringify({ summary: 'Resumo.', tasks, questions }) }],
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
const summarize = (server, transcript = '[0:05] Pratique devagar.') =>
  server.inject({
    method: 'POST',
    url: '/api/summarize',
    headers: { host: 'localhost:8787' },
    payload: { title: 'Aula', transcript },
  });
async function until(check, timeout = 2000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('timed out');
    await new Promise(r => setTimeout(r, 10));
  }
}
describe('evidence matching', () => {
  it('ignores case, accents, quotes, punctuation, spacing and compatibility forms', () => {
    const transcript =
      '[0:05] Olá.\n[1:12] Pratique  “devagar”, com a MÃO esquerda.\n[2:03] Toque o ﬁnal piano';
    const at = findEvidence(transcript, 'pratique "devagar" com a mao esquerda');
    expect(transcript.slice(at, at + 8)).toBe('Pratique');
    expect(timestampBefore(transcript, at)).toBe(72);
    expect(timestampBefore(transcript, findEvidence(transcript, 'Toque o final piano.'))).toBe(123);
  });
  it('matches evidence that spans a timestamp marker and keeps whole words', () => {
    const transcript = '[0:10] Respire antes da frase.\n[0:14] Depois acelere o girassol';
    expect(
      timestampBefore(transcript, findEvidence(transcript, 'Respire antes da frase. Depois acelere')),
    ).toBe(10);
    expect(findEvidence(transcript, 'sol')).toBe(-1);
    expect(findEvidence(transcript, '...')).toBe(-1);
    expect(findEvidence(transcript, 'Toque a 180 BPM')).toBe(-1);
  });
  it('maps folded characters back to the original text', () => {
    const folded = foldForMatch('[0:01] Ação — “já”!');
    expect(folded.text).toBe('acao ja');
    expect(folded.positions[0]).toBe(7);
    expect(folded.positions.length).toBe(folded.text.length);
  });
});
describe('AI concurrency', () => {
  it('reserves a slot when checking, so a third concurrent call is refused', async () => {
    let open;
    const gate = new Promise(r => (open = r));
    let calls = 0;
    // The three auth checks finish together, which is when concurrent requests used to interleave.
    const verified = new Promise(r => setTimeout(r, 20));
    const server = await app({
      env: { OPENAI_API_KEY: 'test-key' },
      authClient: {
        auth: {
          getUser: async () => {
            await verified;
            return { data: { user: { id: 'aluna' } }, error: null };
          },
        },
      },
      upstream: async () => {
        calls++;
        await gate;
        return review([{ title: 'Devagar', evidence: 'Pratique devagar', timestamp: null }]);
      },
    });
    const signedIn = () =>
      server.inject({
        method: 'POST',
        url: '/api/summarize',
        headers: { authorization: 'Bearer token' },
        payload: { title: 'Aula', transcript: '[0:05] Pratique devagar.' },
      });
    const responses = [signedIn(), signedIn(), signedIn()];
    const refused = await Promise.race(responses);
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error).toContain('processando outras aulas');
    await until(() => calls === 2);
    open();
    expect((await Promise.all(responses)).map(r => r.statusCode).sort()).toEqual([200, 200, 429]);
    expect(calls).toBe(2);
    expect((await signedIn()).statusCode).toBe(200);
  });
  it('releases the slot after invalid input and provider failures', async () => {
    let fail = true;
    const server = await app({
      env: local,
      upstream: async () => {
        if (fail) throw new Error('offline');
        return review([]);
      },
    });
    expect((await summarize(server, 'x')).statusCode).toBe(400);
    expect((await summarize(server)).statusCode).toBe(504);
    expect((await summarize(server)).statusCode).toBe(504);
    fail = false;
    expect((await summarize(server)).statusCode).toBe(200);
  });
  it('cancels the provider call and releases the slot when the client disconnects', async () => {
    let hang = true,
      started = 0,
      cancelled = 0;
    const server = await app({
      env: local,
      upstream: async (url, init) => {
        if (!hang) return review([]);
        started++;
        return new Promise((_, reject) =>
          init.signal.addEventListener('abort', () => {
            cancelled++;
            reject(new Error('aborted'));
          }),
        );
      },
    });
    await server.listen({ port: 0, host: '127.0.0.1' });
    const url = `http://127.0.0.1:${server.server.address().port}/api/summarize`;
    const post = signal =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Aula', transcript: '[0:05] Pratique devagar.' }),
        signal,
      });
    const clients = [new AbortController(), new AbortController()];
    const pending = clients.map(c => post(c.signal).catch(() => null));
    await until(() => started === 2);
    clients.forEach(c => c.abort());
    await Promise.all(pending);
    await until(() => cancelled === 2);
    hang = false;
    expect((await post()).status).toBe(200);
  });
  it('answers rate limits in Portuguese', async () => {
    const server = await app({ env: local, upstream: async () => review([]) });
    for (let i = 0; i < 6; i++) expect((await summarize(server)).statusCode).toBe(200);
    const limited = await summarize(server);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toMatch(/^Muitas solicitações seguidas/);
  });
});
describe('AI service boundaries', () => {
  it('serves production files with cache headers without the AI rate limit', async () => {
    const server = await app({ env: { SERVE_STATIC: 'true' }, staticRoot: resolve('public') });
    const manifest = await server.inject('/manifest.webmanifest');
    expect(manifest.statusCode).toBe(200);
    expect(manifest.headers['cache-control']).toBe('no-cache');
    expect(manifest.headers['x-content-type-options']).toBe('nosniff');
    for (let i = 0; i < 35; i++) expect((await server.inject('/icon.svg')).statusCode).toBe(200);
    expect((await server.inject('/api/missing')).statusCode).toBe(404);
  });
  it('reports not configured without exposing secret values', async () => {
    const server = await app({ env: {} });
    const response = await server.inject('/api/status');
    expect(response.json()).toEqual({ configured: false, cloudAuth: false, maxAudioMB: 24 });
  });
  it('rejects unauthenticated requests when local development is disabled', async () => {
    const server = await app({ env: { OPENAI_API_KEY: 'test-key' } });
    const response = await server.inject({
      method: 'POST',
      url: '/api/summarize',
      payload: { title: 'Aula', transcript: 'Uma orientação' },
    });
    expect(response.statusCode).toBe(401);
  });
  it('rejects hostile origins even when localhost development is enabled', async () => {
    const server = await app({ env: { ALLOW_LOCAL_AI: 'true', OPENAI_API_KEY: 'test-key' } });
    const response = await server.inject({
      method: 'POST',
      url: '/api/summarize',
      headers: { host: 'localhost:8787', origin: 'https://untrusted.example' },
      payload: { title: 'Aula', transcript: 'Uma orientação' },
    });
    expect(response.statusCode).toBe(401);
  });
  it('returns an honest unavailable error with no API key', async () => {
    const server = await app({ env: { ALLOW_LOCAL_AI: 'true' } });
    const response = await server.inject({
      method: 'POST',
      url: '/api/summarize',
      headers: { host: 'localhost:8787' },
      payload: { title: 'Aula', transcript: 'Uma orientação' },
    });
    expect(response.statusCode).toBe(503);
  });
  it('keeps only task evidence present in the transcript and derives timestamps', async () => {
    const server = await app({
      env: { ALLOW_LOCAL_AI: 'true', OPENAI_API_KEY: 'test-key' },
      upstream: async () =>
        new Response(
          JSON.stringify({
            status: 'completed',
            output: [
              {
                content: [
                  {
                    type: 'output_text',
                    text: JSON.stringify({
                      summary: 'Prática lenta.',
                      tasks: [
                        { title: 'Estudar devagar', evidence: 'Pratique devagar.', timestamp: 999 },
                        { title: 'Inventada', evidence: 'Toque a 180 BPM.', timestamp: 5 },
                      ],
                      questions: [],
                    }),
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    });
    const response = await server.inject({
      method: 'POST',
      url: '/api/summarize',
      headers: { host: 'localhost:8787' },
      payload: { title: 'Aula', transcript: '[01:12] Pratique devagar.' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().tasks).toEqual([
      { title: 'Estudar devagar', evidence: 'Pratique devagar.', timestamp: 72 },
    ]);
  });
  it('keeps evidence quoted with different accents, quotes and spacing', async () => {
    const server = await app({
      env: local,
      upstream: async () =>
        review([
          { title: 'Mão esquerda', evidence: 'mao esquerda "sozinha",  bem  devagar', timestamp: null },
          { title: 'Inventada', evidence: 'Toque a 180 BPM.', timestamp: 5 },
        ]),
    });
    const response = await summarize(
      server,
      '[0:05] Olá.\n[2:40] Agora a Mão Esquerda “sozinha”, bem devagar.',
    );
    expect(response.json().tasks).toEqual([
      { title: 'Mão esquerda', evidence: 'mao esquerda "sozinha",  bem  devagar', timestamp: 160 },
    ]);
  });
  it('validates the input before contacting the provider', async () => {
    let called = false;
    const server = await app({
      env: { ALLOW_LOCAL_AI: 'true', OPENAI_API_KEY: 'test-key' },
      upstream: async () => {
        called = true;
        throw new Error('unexpected');
      },
    });
    const response = await server.inject({
      method: 'POST',
      url: '/api/summarize',
      headers: { host: 'localhost:8787' },
      payload: { title: 'Aula', transcript: 'x' },
    });
    expect(response.statusCode).toBe(400);
    expect(called).toBe(false);
  });
});
