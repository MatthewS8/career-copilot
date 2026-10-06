const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { createServer } = require('../server');

let server;
let baseUrl;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('serves the app with security headers', async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await response.text(), /A clearer path to/);
});

test('rejects unsupported providers and missing job details', async () => {
  const invalidProvider = await fetch(`${baseUrl}/api/cover-letter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'unknown' }),
  });
  assert.equal(invalidProvider.status, 400);
  assert.match((await invalidProvider.json()).error, /Choose OpenAI/);

  const missingDescription = await fetch(`${baseUrl}/api/cover-letter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai', job: { title: 'Designer', company: 'Example' } }),
  });
  assert.equal(missingDescription.status, 400);
  assert.match((await missingDescription.json()).error, /description are required/);
});

test('returns a clear error when the selected provider key is not configured', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const response = await fetch(`${baseUrl}/api/cover-letter`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        job: { title: 'Designer', company: 'Example', description: 'Design useful products.' },
      }),
    });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /OPENAI_API_KEY/);
  } finally {
    if (oldKey !== undefined) process.env.OPENAI_API_KEY = oldKey;
  }
});

test('sends a cover-letter prompt to the selected provider', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  let outboundRequest;
  global.fetch = async (url, options) => {
    outboundRequest = { url, options };
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Dear hiring team,' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const response = await originalFetch(`${baseUrl}/api/cover-letter`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        profile: { name: 'Alex', skills: 'Research' },
        job: { title: 'Designer', company: 'Example', description: 'Make useful products.' },
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { letter: 'Dear hiring team,' });
    assert.equal(outboundRequest.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(outboundRequest.options.headers.Authorization, ['Bearer', 'test-key'].join(' '));
    assert.match(outboundRequest.options.body, /Make useful products/);
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});

test('rejects malformed JSON', async () => {
  const response = await fetch(`${baseUrl}/api/cover-letter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /valid JSON/);
});

test('blocks requests to paths outside the public directory', async () => {
  const response = await fetch(`${baseUrl}/%2e%2e/server.js`);
  assert.equal(response.status, 404);
});
