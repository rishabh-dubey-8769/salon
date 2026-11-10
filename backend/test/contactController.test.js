const test = require('node:test');
const assert = require('node:assert/strict');
const { sendAdminContactMessage } = require('../controllers/contactController');

const invoke = async (request) => {
  const response = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  let forwardedError;
  await sendAdminContactMessage(request, response, (error) => { forwardedError = error; });
  return { response, forwardedError };
};

test('contact controller sends role-specific issue mail and an optional image attachment', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    BREVO_API_KEY: process.env.BREVO_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
  };
  const sentEmails = [];
  process.env.ADMIN_EMAIL = 'admin@example.com';
  process.env.BREVO_API_KEY = 'test-brevo-key';
  process.env.EMAIL_FROM = 'verified@example.com';
  global.fetch = async (url, options) => {
    sentEmails.push(JSON.parse(options.body));
    return { ok: true, status: 201 };
  };

  try {
    const { response, forwardedError } = await invoke({
      user: { role: 'owner', name: 'Salon Owner', email: 'owner@example.com', uid: 'uid-123' },
      body: {
        message: 'Please update my salon details.',
        attachment: { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWQAAAAASUVORK5CYII=' },
      },
    });

    assert.equal(forwardedError, undefined);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
    assert.deepEqual(sentEmails[0].to, [{ email: 'admin@example.com' }]);
    assert.equal(sentEmails[0].subject, 'SalonFlow | Salon Owner Issue');
    assert.deepEqual(sentEmails[0].replyTo, { email: 'owner@example.com' });
    assert.match(sentEmails[0].textContent, /UID: uid-123/);
    assert.equal(
      Buffer.from(sentEmails[0].attachment[0].content, 'base64').subarray(0, 8).toString('hex'),
      '89504e470d0a1a0a'
    );
    assert.equal(sentEmails[0].attachment[0].name, 'salonflow-issue.png');
  } finally {
    global.fetch = originalFetch;
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
});

test('contact controller rejects invalid messages and unsupported attachments', async () => {
  const invalidMessage = await invoke({
    user: { role: 'user', name: 'Customer', uid: 'uid-456' },
    body: { message: '   ' },
  });
  assert.equal(invalidMessage.response.statusCode, 400);

  const missingBody = await invoke({
    user: { role: 'user', name: 'Customer', uid: 'uid-456' },
    body: null,
  });
  assert.equal(missingBody.response.statusCode, 400);

  const invalidImage = await invoke({
    user: { role: 'user', name: 'Customer', uid: 'uid-456' },
    body: { message: 'I need help.', attachment: { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' } },
  });
  assert.equal(invalidImage.response.statusCode, 400);
});
