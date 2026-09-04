const assert = require('node:assert/strict');
const test = require('node:test');
const { accountRateLimitKey } = require('../src/middleware/rateLimiter');

test('account rate-limit keys are stable keyed hashes without raw email or IP data', () => {
  const originalSalt = process.env.RATE_LIMIT_KEY_SALT;
  process.env.RATE_LIMIT_KEY_SALT = 'rate-limit-test-salt-with-32-characters';
  try {
    const emailRequest = { body: { email: 'Person@Example.com' }, ip: '203.0.113.10' };
    const normalizedEmailRequest = { body: { email: 'person@example.com' }, ip: '203.0.113.11' };
    const key = accountRateLimitKey(emailRequest);
    assert.equal(key, accountRateLimitKey(normalizedEmailRequest));
    assert.equal(key.includes('person@example.com'), false);
    assert.equal(key.includes('203.0.113.10'), false);
    assert.match(key, /^[a-f0-9]{64}$/);
  } finally {
    if (originalSalt === undefined) delete process.env.RATE_LIMIT_KEY_SALT;
    else process.env.RATE_LIMIT_KEY_SALT = originalSalt;
  }
});

test('different accounts on a shared IP receive different account keys', () => {
  const first = accountRateLimitKey({ body: { email: 'first@example.com' }, ip: '203.0.113.10' });
  const second = accountRateLimitKey({ body: { email: 'second@example.com' }, ip: '203.0.113.10' });
  assert.notEqual(first, second);
});
