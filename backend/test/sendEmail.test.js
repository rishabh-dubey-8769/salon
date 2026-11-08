const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const sendEmail = require('../utils/sendEmail');

const withEnvironment = async (updates, callback) => {
  const keys = [
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
    'EMAIL_FROM',
    'GMAIL_USER',
    'GMAIL_APP_PASSWORD',
    'RENDER',
    'NODE_ENV',
  ];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  keys.forEach((key) => {
    if (Object.hasOwn(updates, key)) process.env[key] = updates[key];
    else delete process.env[key];
  });
  try {
    return await callback();
  } finally {
    keys.forEach((key) => {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    });
  }
};

test('uses the Resend HTTPS API and maps message fields and attachments', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ id: 'email-123' }) };
  };

  try {
    const result = await withEnvironment({
      RESEND_API_KEY: 'test-resend-key',
      RESEND_FROM_EMAIL: 'support@example.com',
    }, () => sendEmail({
      from: { name: 'SalonFlow', address: 'ignored@example.com' },
      to: 'customer@example.com',
      replyTo: 'reply@example.com',
      subject: 'Verification code',
      text: 'Your code is 123456.',
      html: '<p>Your code is 123456.</p>',
      attachments: [{
        filename: 'issue.png',
        content: Buffer.from('image-bytes'),
        contentType: 'image/png',
      }],
    }));

    assert.equal(result.id, 'email-123');
    assert.equal(requests[0].url, 'https://api.resend.com/emails');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer test-resend-key');
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      from: 'SalonFlow <support@example.com>',
      to: ['customer@example.com'],
      subject: 'Verification code',
      reply_to: 'reply@example.com',
      text: 'Your code is 123456.',
      html: '<p>Your code is 123456.</p>',
      attachments: [{
        filename: 'issue.png',
        content: Buffer.from('image-bytes').toString('base64'),
        content_type: 'image/png',
      }],
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('does not attempt blocked Gmail SMTP from Render production without Resend credentials', async () => {
  const originalCreateTransport = nodemailer.createTransport;
  nodemailer.createTransport = () => {
    throw new Error('SMTP must not be used on Render Free.');
  };
  try {
    await assert.rejects(
      withEnvironment({ RENDER: 'true', NODE_ENV: 'production' }, () => sendEmail({
        from: { name: 'SalonFlow', address: 'support@example.com' },
        to: 'customer@example.com',
        subject: 'Verification code',
        text: 'Your code is 123456.',
      })),
      /Render production email requires RESEND_API_KEY/
    );
  } finally {
    nodemailer.createTransport = originalCreateTransport;
  }
});

test('reports Resend API failures explicitly', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 422,
    json: async () => ({ message: 'Sender domain is not verified' }),
  });
  try {
    await assert.rejects(
      withEnvironment({
        RESEND_API_KEY: 'test-resend-key',
        RESEND_FROM_EMAIL: 'support@example.com',
      }, () => sendEmail({
        to: 'customer@example.com',
        subject: 'Verification code',
        text: 'Your code is 123456.',
      })),
      /Email provider rejected the message \(422\): Sender domain is not verified/
    );
  } finally {
    global.fetch = originalFetch;
  }
});
