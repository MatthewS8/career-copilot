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
  const html = await response.text();
  assert.match(html, /A clearer path to/);
  assert.match(html, /option value="Remote"/);
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

test('rejects unsupported profile extraction sources and empty text', async () => {
  const invalidSource = await fetch(`${baseUrl}/api/extract-profile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai', source: 'url', content: 'https://linkedin.com/in/example' }),
  });
  assert.equal(invalidSource.status, 400);
  assert.match((await invalidSource.json()).error, /resume or LinkedIn profile text/);

  const emptyContent = await fetch(`${baseUrl}/api/extract-profile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai', source: 'resume', content: '  ' }),
  });
  assert.equal(emptyContent.status, 400);
  assert.match((await emptyContent.json()).error, /text first/);
});

test('returns a clear error when the extraction provider key is not configured', async () => {
  const oldKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const response = await fetch(`${baseUrl}/api/extract-profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini', source: 'resume', content: 'Resume text' }),
    });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /GEMINI_API_KEY/);
  } finally {
    if (oldKey !== undefined) process.env.GEMINI_API_KEY = oldKey;
  }
});

test('extracts only supported profile fields through the configured provider', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  let outboundRequest;
  global.fetch = async (url, options) => {
    outboundRequest = { url, options };
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: `Here is the extracted profile:\n\`\`\`json\n${JSON.stringify({
            name: 'Alex Morgan',
            roles: 'Product Designer',
            location: 'Berlin',
            workStyle: 'Remote-first',
            skills: 'Research, prototyping',
            priorities: '',
            experience: 'Five years designing digital products.',
            ignored: 'not returned',
          })}\n\`\`\`\nI hope this helps.`,
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const response = await originalFetch(`${baseUrl}/api/extract-profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        source: 'linkedin',
        content: 'Alex Morgan — Product Designer — Berlin',
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      profile: {
        name: 'Alex Morgan',
        roles: 'Product Designer',
        location: 'Berlin',
        workStyle: 'Remote',
        skills: 'Research, prototyping',
        priorities: '',
        experience: 'Five years designing digital products.',
      },
    });
    assert.equal(outboundRequest.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(outboundRequest.options.headers.Authorization, ['Bearer', 'test-key'].join(' '));
    assert.match(outboundRequest.options.body, /Alex Morgan — Product Designer/);
    assert.match(outboundRequest.options.body, /untrusted data/);
    const providerBody = JSON.parse(outboundRequest.options.body);
    assert.equal(providerBody.temperature, 0);
    assert.equal(providerBody.max_completion_tokens, 2_000);
    assert.deepEqual(providerBody.response_format, { type: 'json_object' });
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});

test('parses a complete long provider response before limiting field values', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  global.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ name: 'A'.repeat(12_100) }) } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const response = await originalFetch(`${baseUrl}/api/extract-profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', source: 'resume', content: 'Resume text' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).profile.name.length, 1_000);
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});

for (const configuration of [
  {
    provider: 'gemini',
    keyName: 'GEMINI_API_KEY',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    response: (profileText) => ({ candidates: [{ content: { parts: [{ text: profileText }] } }] }),
    checkRequest: (request) => {
      assert.equal(request.options.headers['x-goog-api-key'], 'test-key');
      const body = JSON.parse(request.options.body);
      assert.equal(body.generationConfig.temperature, 0);
      assert.equal(body.generationConfig.responseMimeType, 'application/json');
    },
  },
  {
    provider: 'anthropic',
    keyName: 'ANTHROPIC_API_KEY',
    url: 'https://api.anthropic.com/v1/messages',
    response: (profileText) => ({ content: [{ type: 'text', text: profileText }] }),
    checkRequest: (request) => {
      assert.equal(request.options.headers['x-api-key'], 'test-key');
      assert.equal(request.options.headers['anthropic-version'], '2023-06-01');
      const body = JSON.parse(request.options.body);
      assert.equal(body.temperature, 0);
      assert.equal(body.max_tokens, 2_000);
    },
  },
]) {
  test(`extracts profile fields through ${configuration.provider}`, async () => {
    const oldKey = process.env[configuration.keyName];
    const originalFetch = global.fetch;
    process.env[configuration.keyName] = 'test-key';
    let outboundRequest;
    global.fetch = async (url, options) => {
      outboundRequest = { url, options };
      return new Response(JSON.stringify(configuration.response('{"name":"Jamie Lee"}')), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    try {
      const response = await originalFetch(`${baseUrl}/api/extract-profile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: configuration.provider, source: 'resume', content: 'Jamie Lee' }),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).profile.name, 'Jamie Lee');
      assert.equal(outboundRequest.url, configuration.url);
      configuration.checkRequest(outboundRequest);
    } finally {
      global.fetch = originalFetch;
      if (oldKey === undefined) delete process.env[configuration.keyName];
      else process.env[configuration.keyName] = oldKey;
    }
  });
}

test('rejects malformed profile extraction output', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  global.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: 'not JSON' } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const response = await originalFetch(`${baseUrl}/api/extract-profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', source: 'resume', content: 'Resume text' }),
    });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /Could not extract/);
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});

test('logs provider failure status without logging provider content', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  const originalConsoleError = console.error;
  process.env.OPENAI_API_KEY = 'test-key';
  let loggedMessage = '';
  global.fetch = async () => new Response('Sensitive provider response', { status: 429 });
  console.error = (message) => { loggedMessage = message; };
  try {
    const response = await originalFetch(`${baseUrl}/api/extract-profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', source: 'resume', content: 'Private resume text' }),
    });
    assert.equal(response.status, 502);
    assert.match(loggedMessage, /openai, 429, Error/);
    assert.doesNotMatch(loggedMessage, /Sensitive|Private|test-key/);
  } finally {
    global.fetch = originalFetch;
    console.error = originalConsoleError;
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
