import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { createServer } from '../server';
import {
  migrateBaseLetters,
  newCoverLetter,
  newJobAssessment,
  restoreGeneratedLetterVersion,
} from '../src/job-storage';

type JsonBody = {
  error: string;
  letter: string;
  saved: boolean;
  provider: string;
  removed: boolean;
  storageError: boolean;
  providers: Record<string, { configured: boolean; source: string }>;
  profile: Record<string, string> & { name: string };
  [key: string]: unknown;
};
type MockRequestOptions = { headers: Headers; body: string };
type CapturedRequest = { url: string; options: MockRequestOptions };
type ProviderConfiguration = {
  provider: 'gemini' | 'anthropic';
  url: string;
  response: (profileText: string) => unknown;
  checkRequest: (request: CapturedRequest) => void;
};

let server: http.Server;
let baseUrl = '';
let dataDirectory = '';

async function responseJson(response: Response): Promise<JsonBody> {
  const parsed: unknown = JSON.parse(await response.text());
  return parsed as JsonBody;
}

function serverPort(target: http.Server): number {
  const address = target.address();
  if (!address || typeof address === 'string')
    throw new Error('Server is not listening on a TCP port.');
  return address.port;
}

function mockFetch(
  callback: (url: string, options: MockRequestOptions) => Response | Promise<Response>,
): void {
  global.fetch = async (input: string | URL | Request, init?: RequestInit) =>
    callback(input instanceof Request ? input.url : String(input), {
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : '',
    });
}

async function configureProvider(provider: 'openai' | 'gemini' | 'anthropic', key = 'test-key') {
  await fetch(`${baseUrl}/api/settings/provider-key?provider=${provider}`, {
    method: 'DELETE',
    headers: { origin: baseUrl },
  });
  const response = await fetch(`${baseUrl}/api/settings/provider-key`, {
    method: 'POST',
    headers: { origin: baseUrl, 'content-type': 'application/json' },
    body: JSON.stringify({ provider, key }),
  });
  assert.equal(response.status, 200);
}

before(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'jobfinder-test-'));
  server = createServer({ dataDirectory });
  await new Promise<void>((resolve) => server.listen({ port: 0, host: '127.0.0.1' }, resolve));
  baseUrl = `http://127.0.0.1:${serverPort(server).toString()}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dataDirectory, { recursive: true, force: true });
});

test('serves the app with security headers', async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/html/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const html = await response.text();
  assert.match(html, /<div id="app"><\/div>/);
  const scriptPath = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
  assert.ok(scriptPath);
  const scriptResponse = await fetch(new URL(scriptPath, baseUrl));
  assert.equal(scriptResponse.status, 200);
  const script = await scriptResponse.text();
  assert.match(script, /A clearer path to/);
  assert.match(script, /data-view/);
  assert.match(script, /provider-key-form/);
  assert.match(script, /Autofill from resume/);
  assert.match(script, /\.tex/);
  assert.match(script, /Application-context chat/);
  assert.match(script, /Open application studio/);
  assert.match(script, /Generated versions/);
  assert.match(script, /Clear this cover-letter session/);
  assert.match(script, /Discard this saved job assessment from this browser/);
  assert.match(script, /Restore this generated version/);
  assert.match(script, /Clear this application-context chat from this browser/);
  assert.match(script, /Remove this saved job and its local application workspace/);
  assert.doesNotMatch(
    script,
    /letter-title/,
    'the cover-letter workspace must remain embedded in the saved-job application studio',
  );
  const stylesheetPath = html.match(/<link[^>]+href="([^"]+\.css)"/)?.[1];
  assert.ok(stylesheetPath);
  assert.equal((await fetch(new URL(stylesheetPath, baseUrl))).status, 200);
});

test('migrates reusable-base provenance and immutable generated versions', () => {
  const bases = migrateBaseLetters([
    {
      id: 'base-1',
      name: 'General',
      text: 'Base text',
      createdAt: '2026-01-01T00:00:00.000Z',
      sourceJobId: 'job-1',
      sourceJobTitle: 'Designer · Example',
    },
    { name: 'Discarded', text: '' },
  ]);
  assert.deepEqual(bases, [
    {
      id: 'base-1',
      name: 'General',
      text: 'Base text',
      createdAt: '2026-01-01T00:00:00.000Z',
      sourceJobId: 'job-1',
      sourceJobTitle: 'Designer · Example',
    },
  ]);
  const letter = newCoverLetter({
    draft: 'Current draft',
    messages: [],
    versions: [{ id: 'v1', draft: 'Older generated draft', createdAt: '2026-01-01T00:00:00.000Z' }],
    provider: 'invalid',
    baseLetterId: 'base-1',
    baseLetterName: 'General',
  });
  assert.ok(letter);
  assert.equal(letter.startingLetter, '');
  assert.equal(letter.draft, 'Current draft');
  assert.equal(letter.provider, 'openai');
  assert.equal(letter.baseLetterId, 'base-1');
  assert.equal(letter.baseLetterName, 'General');
  assert.deepEqual(letter.versions, [
    {
      id: 'v1',
      draft: 'Older generated draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      request: '',
    },
  ]);
});

test('migrates saved-job assessments defensively', () => {
  assert.deepEqual(
    newJobAssessment({
      score: 72.6,
      rationale: 'Strong technical overlap, with one requirement still unclear.',
      strengths: ['TypeScript', '  Remote experience  ', 4],
      concerns: ['Missing domain experience'],
      unansweredQuestions: ['What is the on-call expectation?'],
      nextAction: 'Ask about on-call during the first conversation.',
      assessedAt: '2026-10-25T09:00:00.000Z',
      inputVersion: 'profile-v1',
    }),
    {
      score: 73,
      rationale: 'Strong technical overlap, with one requirement still unclear.',
      strengths: ['TypeScript', 'Remote experience'],
      concerns: ['Missing domain experience'],
      unansweredQuestions: ['What is the on-call expectation?'],
      nextAction: 'Ask about on-call during the first conversation.',
      assessedAt: '2026-10-25T09:00:00.000Z',
      inputVersion: 'profile-v1',
    },
  );
  assert.equal(newJobAssessment({ score: 'unknown', rationale: 'A rationale' }), undefined);
  assert.equal(newJobAssessment({ score: 60, rationale: '' }), undefined);
});

test('restoring a generated letter preserves the current draft as an immutable version', () => {
  const restored = restoreGeneratedLetterVersion(
    {
      startingLetter: 'Starting point',
      draft: 'Current edited draft',
      messages: [],
      versions: [
        {
          id: 'generated-1',
          draft: 'Original generated draft',
          createdAt: '2026-10-24T09:00:00.000Z',
          request: 'Write a first draft',
        },
      ],
      updatedAt: '2026-10-24T09:00:00.000Z',
      provider: 'openai',
    },
    {
      id: 'generated-1',
      draft: 'Original generated draft',
      createdAt: '2026-10-24T09:00:00.000Z',
      request: 'Write a first draft',
    },
    '2026-10-25T09:00:00.000Z',
  );
  assert.equal(restored.draft, 'Original generated draft');
  assert.equal(restored.updatedAt, '2026-10-25T09:00:00.000Z');
  assert.equal(restored.versions.length, 2);
  assert.deepEqual(restored.versions[0], {
    id: 'generated-1',
    draft: 'Original generated draft',
    createdAt: '2026-10-24T09:00:00.000Z',
    request: 'Write a first draft',
  });
  const preservedDraft = restored.versions.at(-1);
  assert.ok(preservedDraft);
  assert.equal(preservedDraft.draft, 'Current edited draft');
  assert.equal(
    preservedDraft.request,
    'User-edited draft saved before restoring an earlier version.',
  );
});

test('stores a profile on the server for subsequent clients', async () => {
  const profile = {
    name: 'Jamie Lee',
    linkedin: 'https://www.linkedin.com/in/jamie-lee',
    roles: 'Software Engineer',
    location: 'Rome, Italy',
    workStyle: 'Remote',
    skills: 'TypeScript, Svelte',
    priorities: 'Flexible hours',
    experience: 'Built web applications.',
    resume: 'Jamie Lee resume text',
  };
  const saveResponse = await fetch(`${baseUrl}/api/profile`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ profile }),
  });
  assert.equal(saveResponse.status, 200);
  assert.deepEqual((await responseJson(saveResponse)).profile, profile);

  const savedResponse = await fetch(`${baseUrl}/api/profile`);
  assert.equal(savedResponse.status, 200);
  assert.deepEqual((await responseJson(savedResponse)).profile, profile);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(dataDirectory, 'profile.json'), 'utf8')),
    profile,
  );
});

test('rejects profile updates that are not from the JobFinder origin', async () => {
  const response = await fetch(`${baseUrl}/api/profile`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
    body: JSON.stringify({ profile: { name: 'Attacker' } }),
  });
  assert.equal(response.status, 403);
});

test('ignores AI provider environment variables', async () => {
  process.env.GEMINI_API_KEY = 'environment-key-secret';
  const response = await fetch(`${baseUrl}/api/settings`);
  assert.equal(response.status, 200);
  const body = await responseJson(response);
  assert.deepEqual(body.providers.gemini, { configured: false, source: 'none' });
  assert.doesNotMatch(JSON.stringify(body), /environment-key-secret/);
  delete process.env.GEMINI_API_KEY;
});

test('saves provider keys encrypted and uses/removes saved keys server-side', async () => {
  const secret = 'sk-test-private-provider-key';
  const oldKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  delete process.env.OPENAI_API_KEY;
  let providerAuthorization: string | null = null;
  mockFetch(async (_url, options) => {
    providerAuthorization = options.headers.get('authorization');
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Draft letter' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  try {
    const saveResponse = await originalFetch(`${baseUrl}/api/settings/provider-key`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: baseUrl,
      },
      body: JSON.stringify({ provider: 'openai', key: secret }),
    });
    assert.equal(saveResponse.status, 200);
    assert.deepEqual(await responseJson(saveResponse), { saved: true, provider: 'openai' });

    const duplicateResponse = await originalFetch(`${baseUrl}/api/settings/provider-key`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({ provider: 'openai', key: 'sk-second-key' }),
    });
    assert.equal(duplicateResponse.status, 409);

    const encryptedPath = path.join(dataDirectory, 'provider-keys.enc');
    const encryptedContent = await fs.readFile(encryptedPath, 'utf8');
    assert.doesNotMatch(encryptedContent, new RegExp(secret));
    const record = JSON.parse(encryptedContent) as { version: number };
    assert.equal(record.version, 1);
    const masterKeyPath = path.join(dataDirectory, 'key-encryption.key');
    assert.equal((await fs.readFile(masterKeyPath)).length, 32);
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(masterKeyPath)).mode & 0o777, 0o600);
      assert.equal((await fs.stat(encryptedPath)).mode & 0o777, 0o600);
      assert.equal((await fs.stat(dataDirectory)).mode & 0o777, 0o700);
    }

    const statusResponse = await originalFetch(`${baseUrl}/api/settings`);
    const status = await responseJson(statusResponse);
    assert.deepEqual(status.providers.openai, { configured: true, source: 'saved' });
    assert.doesNotMatch(JSON.stringify(status), new RegExp(secret));

    const letterResponse = await originalFetch(`${baseUrl}/api/cover-letter`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        job: { title: 'Designer', company: 'Example', description: 'Design useful products.' },
      }),
    });
    assert.equal(letterResponse.status, 200);
    assert.equal(providerAuthorization, ['Bearer', secret].join(' '));

    const removeResponse = await originalFetch(
      `${baseUrl}/api/settings/provider-key?provider=openai`,
      {
        method: 'DELETE',
        headers: { 'sec-fetch-site': 'same-origin' },
      },
    );
    assert.deepEqual(await responseJson(removeResponse), {
      removed: true,
      provider: 'openai',
    });
    assert.deepEqual(
      (await responseJson(await originalFetch(`${baseUrl}/api/settings`))).providers.openai,
      { configured: false, source: 'none' },
    );
    const missingKeyResponse = await originalFetch(`${baseUrl}/api/cover-letter`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        job: { title: 'Designer', company: 'Example', description: 'Design useful products.' },
      }),
    });
    assert.equal(missingKeyResponse.status, 503);
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});

test('allows only one concurrent save for a provider', async () => {
  const concurrentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'jobfinder-concurrent-'));
  const concurrentServer = createServer({ dataDirectory: concurrentDirectory });
  const oldKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  await new Promise<void>((resolve) =>
    concurrentServer.listen({ port: 0, host: '127.0.0.1' }, resolve),
  );
  const concurrentUrl = `http://127.0.0.1:${serverPort(concurrentServer).toString()}`;
  try {
    const responses = await Promise.all(
      ['first-concurrent-key', 'second-concurrent-key'].map((key) =>
        fetch(`${concurrentUrl}/api/settings/provider-key`, {
          method: 'POST',
          headers: { origin: concurrentUrl, 'content-type': 'application/json' },
          body: JSON.stringify({ provider: 'openai', key }),
        }),
      ),
    );
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    const conflict = responses.find((response) => response.status === 409);
    assert.ok(conflict);
    assert.match((await responseJson(conflict)).error, /already saved/);

    const status = await responseJson(await fetch(`${concurrentUrl}/api/settings`));
    assert.deepEqual(status.providers.openai, { configured: true, source: 'saved' });
  } finally {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
    await new Promise((resolve) => concurrentServer.close(resolve));
    await fs.rm(concurrentDirectory, { recursive: true, force: true });
  }
});

test('rejects cross-origin API key changes', async () => {
  const missingOrigin = await fetch(`${baseUrl}/api/settings/provider-key?provider=openai`, {
    method: 'DELETE',
  });
  assert.equal(missingOrigin.status, 403);

  const foreignOrigin = await fetch(`${baseUrl}/api/settings/provider-key`, {
    method: 'POST',
    headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai', key: 'sk-should-not-save' }),
  });
  assert.equal(foreignOrigin.status, 403);

  const reboundHost = await fetch(`${baseUrl}/api/settings/provider-key`, {
    method: 'POST',
    headers: {
      host: 'attacker.example',
      origin: 'http://attacker.example',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ provider: 'openai', key: 'sk-should-not-save' }),
  });
  assert.equal(reboundHost.status, 403);

  const reboundApiStatus = await new Promise((resolve, reject) => {
    const request = http.request(
      new URL(`${baseUrl}/api/settings`),
      {
        headers: { host: 'attacker.example' },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.on('error', reject);
    request.end();
  });
  assert.equal(reboundApiStatus, 403);

  const reboundProviderRequest = await new Promise((resolve, reject) => {
    const request = http.request(
      new URL(`${baseUrl}/api/cover-letter`),
      {
        method: 'POST',
        headers: { host: 'attacker.example', 'content-type': 'application/json' },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.on('error', reject);
    request.end(
      JSON.stringify({
        provider: 'openai',
        job: { title: 'Designer', company: 'Example', description: 'Design useful products.' },
      }),
    );
  });
  assert.equal(reboundProviderRequest, 403);
});

test('reports recovery guidance when encrypted storage is damaged', async () => {
  const damagedDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'jobfinder-damaged-'));
  const damagedServer = createServer({ dataDirectory: damagedDirectory });
  await fs.writeFile(path.join(damagedDirectory, 'key-encryption.key'), Buffer.alloc(32, 1), {
    mode: 0o600,
  });
  await fs.writeFile(path.join(damagedDirectory, 'provider-keys.enc'), 'not encrypted json', {
    mode: 0o600,
  });
  await new Promise<void>((resolve) =>
    damagedServer.listen({ port: 0, host: '127.0.0.1' }, resolve),
  );
  const damagedUrl = `http://127.0.0.1:${serverPort(damagedServer).toString()}`;
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const response = await fetch(`${damagedUrl}/api/cover-letter`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        job: { title: 'Designer', company: 'Example', description: 'Design useful products.' },
      }),
    });
    assert.equal(response.status, 503);

    const settingsResponse = await fetch(`${damagedUrl}/api/settings`);
    const settings = await responseJson(settingsResponse);
    assert.equal(settings.storageError, true);
    assert.deepEqual(settings.providers.openai, { configured: false, source: 'none' });

    const saveResponse = await fetch(`${damagedUrl}/api/settings/provider-key`, {
      method: 'POST',
      headers: { origin: damagedUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', key: 'new-key' }),
    });
    assert.equal(saveResponse.status, 503);
    assert.match((await responseJson(saveResponse)).error, /remove provider-keys\.enc/);

    await fs.rm(path.join(damagedDirectory, 'provider-keys.enc'));
    const resetResponse = await fetch(`${damagedUrl}/api/settings/provider-key`, {
      method: 'POST',
      headers: { origin: damagedUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', key: 'reset-key' }),
    });
    assert.equal(resetResponse.status, 200);
    assert.deepEqual(
      (await responseJson(await fetch(`${damagedUrl}/api/settings`))).providers.openai,
      {
        configured: true,
        source: 'saved',
      },
    );
  } finally {
    console.error = originalConsoleError;
    await new Promise((resolve) => damagedServer.close(resolve));
    await fs.rm(damagedDirectory, { recursive: true, force: true });
  }
});

test('rejects unsupported providers and missing job details', async () => {
  const invalidProvider = await fetch(`${baseUrl}/api/cover-letter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'unknown' }),
  });
  assert.equal(invalidProvider.status, 400);
  assert.match((await responseJson(invalidProvider)).error, /Choose OpenAI/);

  const missingDescription = await fetch(`${baseUrl}/api/cover-letter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai', job: { title: 'Designer', company: 'Example' } }),
  });
  assert.equal(missingDescription.status, 400);
  assert.match((await responseJson(missingDescription)).error, /description are required/);
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
    assert.match((await responseJson(response)).error, /API settings/);
  } finally {
    if (oldKey !== undefined) process.env.OPENAI_API_KEY = oldKey;
  }
});

test('sends a cover-letter prompt to the selected provider', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  await configureProvider('openai');
  let outboundRequest: CapturedRequest | undefined;
  mockFetch(async (url, options) => {
    outboundRequest = { url, options };
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'Dear hiring team,' } }] }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  });
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
    assert.deepEqual(await responseJson(response), { letter: 'Dear hiring team,' });
    assert.ok(outboundRequest);
    assert.equal(outboundRequest.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(
      outboundRequest.options.headers.get('authorization'),
      ['Bearer', 'test-key'].join(' '),
    );
    assert.match(outboundRequest.options.body, /Make useful products/);
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});

test('proposes a grounded, reviewable resume update without persisting it', async () => {
  const originalFetch = global.fetch;
  await configureProvider('openai');
  let outboundRequest: CapturedRequest | undefined;
  mockFetch(async (url, options) => {
    outboundRequest = { url, options };
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ resume: 'Reviewed resume draft' }) } }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  try {
    const response = await originalFetch(`${baseUrl}/api/resume-update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        profile: { name: 'Alex', resume: 'Original resume', experience: 'Built useful tools.' },
        context: 'User-confirmed note: led a migration.',
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await responseJson(response), { resume: 'Reviewed resume draft' });
    assert.ok(outboundRequest);
    assert.match(outboundRequest.options.body, /Original resume/);
    assert.match(outboundRequest.options.body, /User-confirmed note/);
    assert.match(outboundRequest.options.body, /Do not invent or infer experience/);

    const invalidResponse = await originalFetch(`${baseUrl}/api/resume-update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', profile: {} }),
    });
    assert.equal(invalidResponse.status, 400);
  } finally {
    global.fetch = originalFetch;
  }
});

test('application-context chat validates the transcript and keeps the prompt grounded', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  await configureProvider('openai');
  let outboundRequest: CapturedRequest | undefined;
  mockFetch(async (url, options) => {
    outboundRequest = { url, options };
    return new Response(
      JSON.stringify({
        choices: [
          { message: { content: '{"reply":"Use a specific example from your experience."}' } },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  try {
    const response = await originalFetch(`${baseUrl}/api/application-chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        profile: { name: 'Alex', experience: 'Built research tools.' },
        job: { title: 'Designer', company: 'Example', description: 'Make useful products.' },
        applicationContext: 'Candidate confirmed: the application asks about a relevant project.',
        messages: [{ role: 'user', content: 'Practise a project answer.' }],
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await responseJson(response), {
      reply: 'Use a specific example from your experience.',
    });
    assert.ok(outboundRequest);
    assert.match(outboundRequest.options.body, /application asks about a relevant project/);
    assert.match(outboundRequest.options.body, /Practise a project answer/);

    const invalid = await originalFetch(`${baseUrl}/api/application-chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        job: { title: 'Designer', company: 'Example', description: 'Make useful products.' },
        messages: [{ role: 'assistant', content: 'Not a candidate turn.' }],
      }),
    });
    assert.equal(invalid.status, 400);
    assert.match((await responseJson(invalid)).error, /last message/);
  } finally {
    global.fetch = originalFetch;
    if (oldKey !== undefined) process.env.OPENAI_API_KEY = oldKey;
  }
});

test('revises a cover letter from a candidate starting letter and feedback', async () => {
  const originalFetch = global.fetch;
  await configureProvider('openai');
  let prompt = '';
  let instructions = '';
  mockFetch((_url, options) => {
    const body = JSON.parse(options.body) as { messages: { content: string }[] };
    instructions = body.messages[0]?.content ?? '';
    prompt = body.messages[1]?.content ?? '';
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: 'Dear Example hiring team,\n\nUpdated.' } }],
      }),
      { status: 200 },
    );
  });
  try {
    const response = await originalFetch(`${baseUrl}/api/cover-letter`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        profile: { name: 'Alex', skills: 'Research' },
        job: { title: 'Designer', company: 'Example', description: 'Make useful products.' },
        startingLetter: 'Dear team,\n\nI care about useful products.',
        currentDraft: 'Dear Example hiring team,\n\nI care about useful products.',
        revisionRequest: 'Make the opening more direct.',
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await responseJson(response), {
      letter: 'Dear Example hiring team,\n\nUpdated.',
    });
    assert.match(prompt, /Candidate's starting letter/);
    assert.match(prompt, /I care about useful products/);
    assert.match(prompt, /Make the opening more direct/);
    assert.match(instructions, /honor the candidate revision request/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('assesses a saved job with a structured, cautious fit result', async () => {
  const originalFetch = global.fetch;
  await configureProvider('openai');
  let prompt = '';
  let instructions = '';
  mockFetch((_url, options) => {
    const body = JSON.parse(options.body) as { messages: { content: string }[] };
    instructions = body.messages[0]?.content ?? '';
    prompt = body.messages[1]?.content ?? '';
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                score: 72.4,
                rationale:
                  'The stated backend experience aligns with the role, but the listing is brief.',
                strengths: ['TypeScript experience'],
                concerns: ['No salary information'],
                unansweredQuestions: ['What is the team scope?'],
                nextAction: 'Read the original listing and clarify the team scope.',
              }),
            },
          },
        ],
      }),
      { status: 200 },
    );
  });
  try {
    const response = await originalFetch(`${baseUrl}/api/job-assessment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        profile: { roles: 'Backend Engineer', skills: 'TypeScript' },
        job: { title: 'Platform Engineer', company: 'Example' },
        messages: [{ role: 'user', content: 'I prefer remote work in Europe.' }],
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await responseJson(response)).assessment, {
      score: 72,
      rationale: 'The stated backend experience aligns with the role, but the listing is brief.',
      strengths: ['TypeScript experience'],
      concerns: ['No salary information'],
      unansweredQuestions: ['What is the team scope?'],
      nextAction: 'Read the original listing and clarify the team scope.',
    });
    assert.match(prompt, /Platform Engineer/);
    assert.match(prompt, /Not provided\. Identify the missing information as uncertainty\./);
    assert.match(prompt, /I prefer remote work in Europe\./);
    assert.match(instructions, /Do not invent job requirements/);

    const invalid = await originalFetch(`${baseUrl}/api/job-assessment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', job: { company: 'Example' } }),
    });
    assert.equal(invalid.status, 400);
    assert.match((await responseJson(invalid)).error, /title and company/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('rejects unsupported profile extraction sources and empty text', async () => {
  const invalidSource = await fetch(`${baseUrl}/api/extract-profile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'openai',
      source: 'url',
      content: 'https://linkedin.com/in/example',
    }),
  });
  assert.equal(invalidSource.status, 400);
  assert.match((await responseJson(invalidSource)).error, /resume or LinkedIn profile text/);

  const emptyContent = await fetch(`${baseUrl}/api/extract-profile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'openai', source: 'resume', content: '  ' }),
  });
  assert.equal(emptyContent.status, 400);
  assert.match((await responseJson(emptyContent)).error, /text first/);
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
    assert.match((await responseJson(response)).error, /API settings/);
  } finally {
    if (oldKey !== undefined) process.env.GEMINI_API_KEY = oldKey;
  }
});

test('extracts only supported profile fields through the configured provider', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  await configureProvider('openai');
  let outboundRequest: CapturedRequest | undefined;
  mockFetch(async (url, options) => {
    outboundRequest = { url, options };
    return new Response(
      JSON.stringify({
        choices: [
          {
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
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
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
    assert.deepEqual(await responseJson(response), {
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
    assert.ok(outboundRequest);
    assert.equal(outboundRequest.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(
      outboundRequest.options.headers.get('authorization'),
      ['Bearer', 'test-key'].join(' '),
    );
    assert.match(outboundRequest.options.body, /Alex Morgan — Product Designer/);
    assert.match(outboundRequest.options.body, /untrusted data/);
    const providerBody = JSON.parse(outboundRequest.options.body) as {
      temperature: number;
      max_completion_tokens: number;
      response_format: { type: string };
    };
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
  await configureProvider('openai');
  mockFetch(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ name: 'A'.repeat(12_100) }) } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  );
  try {
    const response = await originalFetch(`${baseUrl}/api/extract-profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', source: 'resume', content: 'Resume text' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await responseJson(response)).profile.name.length, 1_000);
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});

for (const configuration of [
  {
    provider: 'gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    response: (profileText: string) => ({
      candidates: [{ content: { parts: [{ text: profileText }] } }],
    }),
    checkRequest: (request: CapturedRequest) => {
      assert.equal(request.options.headers.get('x-goog-api-key'), 'test-key');
      const body = JSON.parse(request.options.body) as {
        generationConfig: { temperature: number; responseMimeType: string };
      };
      assert.equal(body.generationConfig.temperature, 0);
      assert.equal(body.generationConfig.responseMimeType, 'application/json');
    },
  },
  {
    provider: 'anthropic',
    url: 'https://api.anthropic.com/v1/messages',
    response: (profileText: string) => ({ content: [{ type: 'text', text: profileText }] }),
    checkRequest: (request: CapturedRequest) => {
      assert.equal(request.options.headers.get('x-api-key'), 'test-key');
      assert.equal(request.options.headers.get('anthropic-version'), '2023-06-01');
      const body = JSON.parse(request.options.body) as { temperature: number; max_tokens: number };
      assert.equal(body.temperature, 0);
      assert.equal(body.max_tokens, 2_000);
    },
  },
] satisfies ProviderConfiguration[]) {
  test(`extracts profile fields through ${configuration.provider}`, async () => {
    const originalFetch = global.fetch;
    await configureProvider(configuration.provider);
    let outboundRequest: CapturedRequest | undefined;
    mockFetch(async (url, options) => {
      outboundRequest = { url, options };
      return new Response(JSON.stringify(configuration.response('{"name":"Jamie Lee"}')), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    try {
      const response = await originalFetch(`${baseUrl}/api/extract-profile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: configuration.provider,
          source: 'resume',
          content: 'Jamie Lee',
        }),
      });
      assert.equal(response.status, 200);
      assert.equal((await responseJson(response)).profile.name, 'Jamie Lee');
      assert.ok(outboundRequest);
      assert.equal(outboundRequest.url, configuration.url);
      configuration.checkRequest(outboundRequest);
    } finally {
      global.fetch = originalFetch;
    }
  });
}

test('rejects malformed profile extraction output', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  await configureProvider('openai');
  mockFetch(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'not JSON' } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  );
  try {
    const response = await originalFetch(`${baseUrl}/api/extract-profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', source: 'resume', content: 'Resume text' }),
    });
    assert.equal(response.status, 502);
    assert.match((await responseJson(response)).error, /Could not extract/);
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
  await configureProvider('openai');
  let loggedMessage = '';
  mockFetch(async () => new Response('Sensitive provider response', { status: 429 }));
  console.error = (message: unknown) => {
    loggedMessage = String(message);
  };
  try {
    const response = await originalFetch(`${baseUrl}/api/extract-profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        source: 'resume',
        content: 'Private resume text',
      }),
    });
    assert.equal(response.status, 502);
    const body = await responseJson(response);
    assert.match(body.error, /rate-limited/);
    assert.match(loggedMessage, /openai, 429, Error, rate-limited/);
    assert.doesNotMatch(loggedMessage, /Sensitive|Private|test-key/);
    assert.doesNotMatch(body.error, /Sensitive|Private|test-key/);
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
  assert.match((await responseJson(response)).error, /valid JSON/);
});

test('blocks requests to paths outside the built frontend directory', async () => {
  const response = await fetch(`${baseUrl}/%2e%2e/server.js`);
  assert.equal(response.status, 404);
});

test('rejects saving a second website key for the same provider', async () => {
  await configureProvider('anthropic');
  const response = await fetch(`${baseUrl}/api/settings/provider-key`, {
    method: 'POST',
    headers: { origin: baseUrl, 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'anthropic', key: 'another-key' }),
  });
  assert.equal(response.status, 409);
  assert.match((await responseJson(response)).error, /already saved/);
});

test('recruiter chat returns a reply and newly spotted skills', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  await configureProvider('openai', 'environment-key');
  let prompt = '';
  mockFetch((_url, options) => {
    const body = JSON.parse(options.body) as { messages: { content: string }[] };
    prompt = body.messages[1]?.content ?? '';
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reply: 'Tell me more about Kafka.',
                skills: ['Event-driven design'],
                alertSuggestions: ['Backend Engineer Remote Europe'],
              }),
            },
          },
        ],
      }),
      { status: 200 },
    );
  });
  try {
    const response = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        profile: { name: 'Sam', skills: 'C++' },
        messages: [{ role: 'user', content: 'I built a message pipeline.' }],
      }),
    });
    assert.equal(response.status, 200);
    const body = await responseJson(response);
    assert.equal(body.reply, 'Tell me more about Kafka.');
    assert.deepEqual(body.skills, ['Event-driven design']);
    assert.deepEqual(body.alertSuggestions, ['Backend Engineer Remote Europe']);
    assert.match(prompt, /Candidate: I built a message pipeline\./);

    const invalid = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        messages: [{ role: 'assistant', content: 'Hello' }],
      }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});

test('imports user-provided LinkedIn alert email leads without fetching LinkedIn', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  const oldAdzunaId = process.env.ADZUNA_APP_ID;
  const oldAdzunaKey = process.env.ADZUNA_APP_KEY;
  const oldAdzunaCountries = process.env.ADZUNA_COUNTRIES;
  const oldJoobleKeys = process.env.JOOBLE_API_KEYS;
  const originalFetch = global.fetch;
  await configureProvider('openai', 'environment-key');
  delete process.env.ADZUNA_APP_ID;
  delete process.env.ADZUNA_APP_KEY;
  delete process.env.ADZUNA_COUNTRIES;
  delete process.env.JOOBLE_API_KEYS;
  let providerPrompt = '';
  mockFetch((url, options) => {
    if (url.startsWith('https://jobicy.com/')) return new Response(JSON.stringify({ jobs: [] }));
    const request = JSON.parse(options.body) as { messages: { content: string }[] };
    providerPrompt = request.messages[1]?.content ?? '';
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                jobs: [
                  {
                    title: 'Platform Engineer',
                    company: 'Acme',
                    location: 'Rome',
                    description: 'Build APIs.',
                    url: '',
                  },
                  {
                    title: 'Platform Engineer',
                    company: 'Acme',
                    location: 'Rome',
                    description: 'Duplicate.',
                  },
                  { title: 'Missing company', company: '', location: '', description: '' },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200 },
    );
  });
  try {
    const response = await originalFetch(`${baseUrl}/api/import-linkedin-alert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        email:
          'Jobs for you: Platform Engineer at Acme <a href=3D"https://www.linkedin.com/comm/jobs/view/123?trk=3Demail">View job</a>',
      }),
    });
    assert.equal(response.status, 200);
    const body = await responseJson(response);
    assert.match(providerPrompt, /Jobs for you/);
    assert.deepEqual(body.jobs, [
      {
        title: 'Platform Engineer',
        company: 'Acme',
        location: 'Rome',
        description: 'Build APIs.',
        source: 'LinkedIn alert email',
        url: 'https://www.linkedin.com/comm/jobs/view/123?trk=email',
        companySearchUrl: 'https://www.google.com/search?q=Acme%20careers%20Platform%20Engineer',
        matchEvaluated: false,
        reason:
          'Imported from a LinkedIn job-alert email. Verify the current listing before applying.',
      },
    ]);
    assert.deepEqual(body.verification, {
      configured: ['Jobicy'],
      checked: ['Jobicy'],
      unavailable: [],
      leadCount: 1,
      limited: false,
    });
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
    if (oldAdzunaId === undefined) delete process.env.ADZUNA_APP_ID;
    else process.env.ADZUNA_APP_ID = oldAdzunaId;
    if (oldAdzunaKey === undefined) delete process.env.ADZUNA_APP_KEY;
    else process.env.ADZUNA_APP_KEY = oldAdzunaKey;
    if (oldAdzunaCountries === undefined) delete process.env.ADZUNA_COUNTRIES;
    else process.env.ADZUNA_COUNTRIES = oldAdzunaCountries;
    if (oldJoobleKeys === undefined) delete process.env.JOOBLE_API_KEYS;
    else process.env.JOOBLE_API_KEYS = oldJoobleKeys;
  }
});

test('verifies alert leads with configured permitted job APIs without forwarding the email', async () => {
  const oldOpenAiKey = process.env.OPENAI_API_KEY;
  const oldAdzunaId = process.env.ADZUNA_APP_ID;
  const oldAdzunaKey = process.env.ADZUNA_APP_KEY;
  const oldAdzunaCountries = process.env.ADZUNA_COUNTRIES;
  const oldJoobleKeys = process.env.JOOBLE_API_KEYS;
  const originalFetch = global.fetch;
  await configureProvider('openai', 'environment-key');
  process.env.ADZUNA_APP_ID = 'adzuna-id';
  process.env.ADZUNA_APP_KEY = 'adzuna-key';
  process.env.ADZUNA_COUNTRIES = 'it';
  process.env.JOOBLE_API_KEYS = JSON.stringify({ it: 'jooble-key' });
  const sourceRequests: CapturedRequest[] = [];
  mockFetch((url, options) => {
    if (url.startsWith('https://jobicy.com/')) {
      sourceRequests.push({ url, options });
      return new Response(
        JSON.stringify({
          jobs: [
            {
              jobTitle: 'Platform Engineer',
              companyName: 'Acme',
              jobGeo: 'Europe',
              url: 'https://jobicy.com/jobs/platform-engineer-acme',
              jobExcerpt: 'Build APIs.',
              pubDate: '2026-10-01T00:00:00Z',
            },
          ],
        }),
      );
    }
    if (url.startsWith('https://api.adzuna.com/')) {
      sourceRequests.push({ url, options });
      return new Response(
        JSON.stringify({
          results: [
            {
              title: 'Platform Engineer',
              company: { display_name: 'Acme' },
              location: { display_name: 'Rome' },
              redirect_url: 'https://www.adzuna.it/details/123',
              description: 'Build APIs.',
              created: '2026-10-01T00:00:00Z',
            },
          ],
        }),
      );
    }
    if (url.startsWith('https://jooble.org/')) {
      sourceRequests.push({ url, options });
      return new Response(
        JSON.stringify({
          jobs: [
            {
              title: 'Platform Engineer',
              company: 'Acme',
              location: 'Rome',
              link: 'https://it.jooble.org/jdp/123',
              snippet: 'Build APIs.',
              updated: '2026-10-01T00:00:00Z',
            },
          ],
        }),
      );
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                jobs: [
                  {
                    title: 'Platform Engineer',
                    company: 'Acme',
                    location: 'Rome',
                    description: '',
                  },
                ],
              }),
            },
          },
        ],
      }),
    );
  });
  try {
    const response = await originalFetch(`${baseUrl}/api/import-linkedin-alert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', email: 'private alert body' }),
    });
    assert.equal(response.status, 200);
    const body = await responseJson(response);
    assert.deepEqual(body.verification, {
      configured: ['Jobicy', 'Adzuna', 'Jooble'],
      checked: ['Jobicy', 'Adzuna', 'Jooble'],
      unavailable: [],
      leadCount: 1,
      limited: false,
    });
    assert.deepEqual(
      (body.jobs as { source: string }[]).slice(0, 3).map((job) => job.source),
      ['Jobicy (verified)', 'Adzuna (verified)', 'Jooble (verified)'],
    );
    assert.equal(sourceRequests.length, 3);
    for (const request of sourceRequests) {
      assert.doesNotMatch(`${request.url}\n${request.options.body}`, /private alert body/);
    }
  } finally {
    global.fetch = originalFetch;
    if (oldOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldOpenAiKey;
    if (oldAdzunaId === undefined) delete process.env.ADZUNA_APP_ID;
    else process.env.ADZUNA_APP_ID = oldAdzunaId;
    if (oldAdzunaKey === undefined) delete process.env.ADZUNA_APP_KEY;
    else process.env.ADZUNA_APP_KEY = oldAdzunaKey;
    if (oldAdzunaCountries === undefined) delete process.env.ADZUNA_COUNTRIES;
    else process.env.ADZUNA_COUNTRIES = oldAdzunaCountries;
    if (oldJoobleKeys === undefined) delete process.env.JOOBLE_API_KEYS;
    else process.env.JOOBLE_API_KEYS = oldJoobleKeys;
  }
});

test('finds jobs from public boards and ranks them with the provider', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  await configureProvider('openai', 'environment-key');
  const remotiveRequests: string[] = [];
  mockFetch((url) => {
    if (url.startsWith('https://remotive.com/')) {
      remotiveRequests.push(url);
      return new Response(
        JSON.stringify({
          jobs: [
            {
              title: 'Rust Engineer',
              company_name: 'Acme',
              url: 'https://remotive.com/job/1',
              candidate_required_location: 'Europe',
              description: '<p>Build <b>services</b></p>',
              publication_date: '2026-10-01T12:00:00Z',
            },
            { title: 'Bad link', company_name: 'X', url: 'javascript:alert(1)', description: '' },
            {
              title: 'Untrusted host',
              company_name: 'X',
              url: 'https://example.com/job/3',
              description: 'Build services',
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.startsWith('https://www.arbeitnow.com/')) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                matches: [
                  { id: 0, score: 88, reason: 'Rust experience' },
                  { id: 9, score: 99, reason: 'Unknown id' },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200 },
    );
  });
  try {
    const response = await originalFetch(`${baseUrl}/api/find-jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', profile: { roles: 'Rust Engineer' } }),
    });
    assert.equal(response.status, 200);
    const body = await responseJson(response);
    assert.equal(remotiveRequests.length, 1);
    assert.deepEqual(body.jobs, [
      {
        title: 'Rust Engineer',
        company: 'Acme',
        location: 'Europe',
        url: 'https://remotive.com/job/1',
        description: 'Build services',
        source: 'Remotive',
        postedAt: '2026-10-01T12:00:00.000Z',
        score: 88,
        matchEvaluated: true,
        reason: 'Rust experience',
      },
    ]);
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});

test('keeps matching resilient to partial failures and malformed or unsafe job results', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  await configureProvider('openai', 'environment-key');
  let providerPrompt = '';
  let providerInstructions = '';
  mockFetch((url, options) => {
    if (url.startsWith('https://remotive.com/')) {
      return new Response('unavailable', { status: 503 });
    }
    if (url.startsWith('https://www.arbeitnow.com/')) {
      return new Response(
        JSON.stringify({
          data: [
            {
              title: 'Rust Engineer',
              company_name: 'Acme',
              url: 'https://www.arbeitnow.com/jobs/1',
              remote: false,
              description: 'Build Rust systems',
              date: 1_791_230_400,
            },
            {
              title: 'Duplicate',
              company_name: 'Acme',
              url: 'https://www.arbeitnow.com/jobs/1',
              description: 'Build Rust systems',
            },
            {
              title: 'Unsafe link',
              company_name: 'Acme',
              url: 'https://attacker.example/jobs/3',
              description: 'Build Rust systems',
            },
            { title: '', company_name: 'Missing title', url: 'https://www.arbeitnow.com/jobs/4' },
          ],
        }),
        { status: 200 },
      );
    }
    const parsed: unknown = JSON.parse(options.body);
    assert.ok(parsed && typeof parsed === 'object' && 'messages' in parsed);
    assert.ok(Array.isArray(parsed.messages));
    const messages: unknown[] = parsed.messages;
    const secondMessage = messages[1];
    assert.ok(
      secondMessage &&
        typeof secondMessage === 'object' &&
        'content' in secondMessage &&
        typeof secondMessage.content === 'string',
    );
    const firstMessage = messages[0];
    assert.ok(
      firstMessage &&
        typeof firstMessage === 'object' &&
        'content' in firstMessage &&
        typeof firstMessage.content === 'string',
    );
    providerInstructions = firstMessage.content;
    providerPrompt = secondMessage.content;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                matches: [{ id: 0, score: 76, reason: 'Relevant skills and remote location.' }],
              }),
            },
          },
        ],
      }),
      { status: 200 },
    );
  });
  try {
    const response = await originalFetch(`${baseUrl}/api/find-jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        profile: { roles: 'Rust Engineer', location: 'Toronto', workStyle: 'Remote' },
      }),
    });
    assert.equal(response.status, 200);
    const body = await responseJson(response);
    assert.deepEqual(body.jobs, [
      {
        title: 'Rust Engineer',
        company: 'Acme',
        location: 'Location not specified',
        url: 'https://www.arbeitnow.com/jobs/1',
        description: 'Build Rust systems',
        source: 'Arbeitnow',
        postedAt: '2026-10-05T20:00:00.000Z',
        score: 76,
        matchEvaluated: true,
        reason: 'Relevant skills and remote location.',
      },
    ]);
    assert.match(providerInstructions, /location and work style as real constraints/);
    assert.match(providerPrompt, /Toronto; Remote/);
    assert.match(providerPrompt, /Location not specified/);

    mockFetch((url) => {
      if (url.startsWith('https://remotive.com/'))
        return new Response(JSON.stringify({ jobs: { invalid: true } }), { status: 200 });
      if (url.startsWith('https://www.arbeitnow.com/'))
        return new Response(JSON.stringify({ data: 'invalid' }), { status: 200 });
      throw new Error('The provider must not be called when sources contain no usable jobs.');
    });
    const emptyResponse = await originalFetch(`${baseUrl}/api/find-jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', profile: { roles: 'Rust Engineer' } }),
    });
    assert.equal(emptyResponse.status, 200);
    assert.deepEqual((await responseJson(emptyResponse)).jobs, []);

    mockFetch(() => new Response('unavailable', { status: 503 }));
    const failedResponse = await originalFetch(`${baseUrl}/api/find-jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', profile: { roles: 'Rust Engineer' } }),
    });
    assert.equal(failedResponse.status, 502);
    assert.deepEqual((await responseJson(failedResponse)).jobs, []);
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});
