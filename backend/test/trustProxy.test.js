const test = require('node:test');
const assert = require('node:assert/strict');
const { getTrustProxySetting } = require('../utils/trustProxy');

test('trusts exactly one forwarded proxy hop when running on Render by default', () => {
  assert.equal(getTrustProxySetting({ RENDER: 'true' }), 1);
});

test('leaves proxy trust disabled locally unless configured', () => {
  assert.equal(getTrustProxySetting({ RENDER: '', TRUST_PROXY: '' }), false);
});

test('respects an explicitly configured proxy hop count', () => {
  assert.equal(getTrustProxySetting({ RENDER: 'true', TRUST_PROXY: '2' }), 2);
});
