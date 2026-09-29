const test = require('node:test');
const assert = require('node:assert');
const { createNotifier } = require('../src/notify');

test('notifier posts to Resend with the API key, and is disabled without one', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, text: async () => '' };
  };
  const n = createNotifier({ apiKey: 're_test', fetchImpl });
  assert.equal(n.enabled, true);
  await n.send({ to: 'boss@example.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' });
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer re_test');
  const body = JSON.parse(calls[0].opts.body);
  assert.deepEqual(body.to, ['boss@example.com']);
  assert.equal(body.from, 'Team Prime <onboarding@resend.dev>');

  const failing = createNotifier({ apiKey: 're_test', fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'domain not verified' }) });
  await assert.rejects(failing.send({ to: 'a@b.co', subject: 's', text: 't' }), /403: domain not verified/);

  const off = createNotifier({ fetchImpl });
  assert.equal(off.enabled, false);
  assert.deepEqual(await off.send({ to: 'a@b.co', subject: 's' }), { skipped: true });
  assert.equal(calls.length, 1);
});
