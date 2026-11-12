const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

// Exercise the actual browser script with mocked GitHub responses and DOM elements.
async function login({ failure, deniedAccount = false, push = true, saved = false } = {}) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: '', hidden: true, checked: false, innerHTML: '', textContent: '',
      addEventListener() {}, querySelectorAll() { return []; },
      classList: { toggle() {}, add() {}, remove() {} }
    });
    return elements.get(id);
  }
  const storage = new Map(saved ? [['session:hub-gh-token', 'test-token']] : []);
  const calls = [];
  const context = {
    window: { Hub: {
      config: { owner: 'aniketqw', repo: 'pages-hub', branch: 'main', allowedUsers: ['aniketqw'] },
      esc: String, initTheme() {}, checkStatus() {},
      get(k, kind) { return storage.get(kind + ':' + k); },
      set(k, value, kind) { if (value === null) storage.delete(kind + ':' + k); else storage.set(kind + ':' + k, value); }
    } },
    document: { getElementById: element, querySelector: element, querySelectorAll() { return []; } },
    URLSearchParams, TextEncoder, TextDecoder, btoa, atob,
    location: { hash: '' },
    fetch: async (url, opts) => {
      calls.push({ url, ...opts });
      let status = 200, data;
      if (url.endsWith('/user')) data = { login: deniedAccount ? 'someone-else' : 'aniketqw', avatar_url: '' };
      else if (url.endsWith('/repos/aniketqw/pages-hub')) data = { permissions: { push } };
      else if (url.endsWith('/git/blobs')) {
        status = failure?.status || 201;
        data = failure ? { message: failure.message } : { sha: 'empty-blob' };
      } else if (url.includes('/contents/routes.json')) data = { sha: 'routes-sha', content: btoa('{"routes":[]}') };
      else throw new Error('Unexpected API call: ' + url);
      return { status, ok: status < 400, json: async () => data };
    }
  };
  vm.runInNewContext(fs.readFileSync('assets/admin.js', 'utf8'), context);
  if (!saved) {
    element('tok').value = 'test-token';
    element('tokGo').onclick();
  }
  await new Promise(setImmediate);
  return { element, storage, calls };
}

test('read-only token fails sign-in despite account push access', async () => {
  const { element, storage, calls } = await login({ failure: { status: 403, message: 'Resource not accessible by personal access token' } });
  assert.equal(element('loginView').hidden, false);
  assert.equal(element('appView').hidden, true);
  assert.match(element('loginErr').textContent, /aniketqw\/pages-hub.*Contents to Read and write/);
  assert.equal(storage.size, 0);
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  assert.ok(!calls.some(c => c.url.includes('/contents/')));
});

test('write token passes harmless blob check then loads console', async () => {
  const { element, storage, calls } = await login();
  assert.equal(element('appView').hidden, false);
  assert.equal(storage.get('session:hub-gh-token'), 'test-token');
  const probe = calls.find(c => c.method === 'POST');
  assert.deepEqual(JSON.parse(probe.body), { content: '', encoding: 'utf-8' });
  assert.ok(!calls.some(c => /\/git\/(refs|commits|trees)/.test(c.url)));
  const link = new URL(element('patLink').href);
  assert.equal(link.searchParams.get('contents'), 'write');
  assert.equal(link.searchParams.get('target_name'), 'aniketqw');
});

test('cached read-only token is rejected and removed', async () => {
  const { element, storage } = await login({ saved: true, failure: { status: 403, message: 'Resource not accessible by personal access token' } });
  assert.equal(element('loginView').hidden, false);
  assert.equal(storage.size, 0);
});

test('other API failures retain their cause', async () => {
  for (const failure of [{ status: 403, message: 'API rate limit exceeded' }, { status: 500, message: 'Internal Server Error' }]) {
    const { element } = await login({ failure });
    assert.equal(element('loginErr').textContent, failure.message);
  }
  const { element } = await login({ failure: { status: 401, message: 'Bad credentials' } });
  assert.match(element('loginErr').textContent, /expired or revoked/);
});

test('allowlist and account push checks run before any write probe', async () => {
  for (const opts of [{ deniedAccount: true }, { push: false }]) {
    const { element, calls } = await login(opts);
    assert.equal(element('loginView').hidden, false);
    assert.ok(!calls.some(c => c.method === 'POST'));
  }
});
