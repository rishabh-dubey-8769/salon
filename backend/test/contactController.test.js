const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
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
  const originalCreateTransport = nodemailer.createTransport;
  const originalEnv = {
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    GMAIL_USER: process.env.GMAIL_USER,
    GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD,
  };
  const sentEmails = [];
  process.env.ADMIN_EMAIL = 'admin@example.com';
  process.env.GMAIL_USER = 'sender@example.com';
  process.env.GMAIL_APP_PASSWORD = 'test-password';
  nodemailer.createTransport = () => ({ sendMail: async (email) => sentEmails.push(email) });

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
    assert.equal(sentEmails[0].to, 'admin@example.com');
    assert.equal(sentEmails[0].subject, 'SalonFlow | Salon Owner Issue');
    assert.equal(sentEmails[0].replyTo, 'owner@example.com');
    assert.match(sentEmails[0].text, /UID: uid-123/);
    assert.ok(sentEmails[0].attachments[0].content.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')));
    assert.equal(sentEmails[0].attachments[0].contentType, 'image/png');
  } finally {
    nodemailer.createTransport = originalCreateTransport;
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
