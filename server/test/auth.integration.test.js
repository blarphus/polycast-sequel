import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createApp } from '../app.js';
import pool from '../db.js';

const enabled = Boolean(process.env.DATABASE_URL);

function cookieJar() {
  const values = new Map();
  return {
    header() { return [...values].map(([name, value]) => `${name}=${value}`).join('; '); },
    absorb(response) {
      for (const cookie of response.headers.getSetCookie?.() || []) {
        const [pair] = cookie.split(';');
        const separator = pair.indexOf('=');
        values.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
    },
  };
}

async function withServer(run) {
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); } finally { await new Promise((resolve) => server.close(resolve)); }
}

async function request(base, path, { method = 'GET', body, jar, token } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(jar?.header() ? { Cookie: jar.header() } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Correlation-ID': 'auth-integration-test',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  jar?.absorb(response);
  return { response, json: await response.json() };
}

test('auth sessions rotate and logout revokes bearer access', { skip: !enabled }, async () => {
  await withServer(async (base) => {
    const jar = cookieJar();
    const username = `session_${Date.now()}`;
    const signup = await request(base, '/api/signup', {
      method: 'POST', jar, body: { username, password: 'test-password' },
    });
    assert.equal(signup.response.status, 201);
    assert.equal(signup.json.account_type, 'student');

    const restored = await request(base, '/api/session/restore', {
      method: 'POST', jar, body: { token: signup.json.token },
    });
    assert.equal(restored.response.status, 200);
    assert.notEqual(restored.json.token, signup.json.token);
    assert.equal((await request(base, '/api/me', { token: signup.json.token })).response.status, 401);
    assert.equal((await request(base, '/api/me', { token: restored.json.token })).response.status, 200);

    assert.equal((await request(base, '/api/logout', { method: 'POST', token: restored.json.token })).response.status, 200);
    assert.equal((await request(base, '/api/me', { token: restored.json.token })).response.status, 401);
  });
});

test('settings cannot self-elevate roles and unknown privileged fields are rejected', { skip: !enabled }, async () => {
  await withServer(async (base) => {
    const jar = cookieJar();
    const signup = await request(base, '/api/signup', {
      method: 'POST', jar, body: { username: `role_${Date.now()}`, password: 'test-password' },
    });
    const elevation = await request(base, '/api/me/settings', {
      method: 'PATCH',
      token: signup.json.token,
      body: { account_type: 'teacher' },
    });
    assert.equal(elevation.response.status, 400);
    const me = await request(base, '/api/me', { token: signup.json.token });
    assert.equal(me.json.account_type, 'student');
    const teacherOnly = await request(base, '/api/classrooms', {
      method: 'POST', token: signup.json.token, body: { name: 'Forbidden classroom' },
    });
    assert.equal(teacherOnly.response.status, 403);
  });
});

test('opaque device profile sessions allow only attached accounts and support forgetting', { skip: !enabled }, async () => {
  await withServer(async (base) => {
    const jar = cookieJar();
    const first = await request(base, '/api/signup', {
      method: 'POST', jar, body: { username: `profile_a_${Date.now()}`, password: 'test-password' },
    });
    const second = await request(base, '/api/signup', {
      method: 'POST', jar, body: { username: `profile_b_${Date.now()}`, password: 'test-password' },
    });
    const accounts = await request(base, '/api/session/accounts', { jar });
    assert.deepEqual(new Set(accounts.json.accounts.map((account) => account.id)), new Set([first.json.id, second.json.id]));

    const switched = await request(base, '/api/session/switch', {
      method: 'POST', jar, body: { userId: first.json.id },
    });
    assert.equal(switched.response.status, 200);
    assert.equal(switched.json.id, first.json.id);

    const unattached = await request(base, '/api/session/switch', {
      method: 'POST', jar, body: { userId: crypto.randomUUID() },
    });
    assert.equal(unattached.response.status, 403);

    assert.equal((await request(base, `/api/session/accounts/${first.json.id}`, { method: 'DELETE', jar })).response.status, 200);
    assert.equal((await request(base, '/api/session/switch', {
      method: 'POST', jar, body: { userId: first.json.id },
    })).response.status, 403);
  });
});

test.after(async () => {
  if (enabled) await pool.end();
});
