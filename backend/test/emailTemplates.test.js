const test = require('node:test');
const assert = require('node:assert/strict');
const Otp = require('../models/otp');
const { issueOtp } = require('../utils/otp');
const sendMessageEmail = require('../utils/sendMessageEmail');
const sendBookingRejectionEmail = require('../utils/sendBookingRejectionEmail');
const sendBrevoEmail = require('../utils/sendBrevoEmail');
const {
  buildOtpEmail,
  buildMessageEmail,
  buildRejectionEmail,
} = require('../utils/emailTemplates');

test('registration and password-reset OTP emails have clear, distinct subjects and concise code content', () => {
  const registration = buildOtpEmail({ code: '123456', purpose: 'register' });
  const reset = buildOtpEmail({ code: '654321', purpose: 'reset_password' });

  assert.equal(registration.subject, 'SalonFlow | Your email verification code');
  assert.equal(reset.subject, 'SalonFlow | Your password reset code');
  const renderedDigits = [...registration.html.matchAll(/height="50"[^>]*>(\d)<\/td>/g)]
    .map((match) => match[1])
    .join('');
  assert.equal(renderedDigits, '123456');
  assert.match(registration.html, /Welcome to SalonFlow/);
  assert.match(reset.html, /Password reset/);
  assert.match(registration.html, /Expires in 5 minutes/);
  assert.equal((registration.html.match(/width="34" height="50"/g) || []).length, 6);
  assert.match(registration.html, /linear-gradient\(125deg/);
  assert.match(registration.text, /Never share this code/);
});

test('OTP delivery sends the matching rich email template for sign-up and password reset', async () => {
  const originalFetch = global.fetch;
  const originalFind = Otp.findOne;
  const originalUpdate = Otp.findOneAndUpdate;
  const originalDelete = Otp.deleteOne;
  const originalSecret = process.env.OTP_SECRET;
  const originalBrevoApiKey = process.env.BREVO_API_KEY;
  const originalEmailFrom = process.env.EMAIL_FROM;
  const sentEmails = [];
  process.env.OTP_SECRET = 'test-secret-for-email-template-validation';
  process.env.BREVO_API_KEY = 'test-brevo-key';
  process.env.EMAIL_FROM = 'verified@example.com';
  Otp.findOne = async () => null;
  Otp.findOneAndUpdate = async () => ({});
  Otp.deleteOne = async () => ({ deletedCount: 0 });
  global.fetch = async (url, options) => {
    sentEmails.push({ url, options, payload: JSON.parse(options.body) });
    return { ok: true, status: 201 };
  };
  try {
    await issueOtp('signup@example.com', 'register');
    await issueOtp('reset@example.com', 'reset_password');
    assert.equal(sentEmails[0].url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(sentEmails[0].options.headers['api-key'], 'test-brevo-key');
    assert.equal(sentEmails[0].payload.sender.email, 'verified@example.com');
    assert.equal(sentEmails[0].payload.subject, 'SalonFlow | Your email verification code');
    assert.equal(sentEmails[1].payload.subject, 'SalonFlow | Your password reset code');
    assert.match(sentEmails[0].payload.htmlContent, /Your sign-up, beautifully simple\./);
    assert.match(sentEmails[1].payload.htmlContent, /A fresh start, securely\./);
    assert.ok(sentEmails.every((email) => email.payload.textContent && email.payload.htmlContent));
  } finally {
    global.fetch = originalFetch;
    Otp.findOne = originalFind;
    Otp.findOneAndUpdate = originalUpdate;
    Otp.deleteOne = originalDelete;
    if (originalSecret === undefined) delete process.env.OTP_SECRET;
    else process.env.OTP_SECRET = originalSecret;
    if (originalBrevoApiKey === undefined) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = originalBrevoApiKey;
    if (originalEmailFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = originalEmailFrom;
  }
});

test('email templates escape user-provided content and include readable text alternatives', () => {
  const message = buildMessageEmail({
    sender: { name: '<Taylor>', email: 'taylor@example.com', role: 'user' },
    context: 'Salon <One>',
    message: '<img src=x onerror=alert(1)>',
  });
  const rejection = buildRejectionEmail({
    customerName: '<Alex>',
    salonName: 'Salon & Co',
    reason: '<script>reason</script>',
    feedbackUrl: 'https://example.com/feedback?token=abc&source=email',
  });

  assert.match(message.subject, /Salon <One>/);
  assert.match(message.html, /&lt;Taylor&gt;/);
  assert.match(message.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(message.html, /<img src=x/);
  assert.match(message.text, /<img src=x onerror=alert\(1\)>/);
  assert.match(rejection.html, /&lt;Alex&gt;/);
  assert.match(rejection.html, /&lt;script&gt;reason&lt;\/script&gt;/);
  assert.match(rejection.html, /Share your feedback/);
  assert.match(rejection.text, /https:\/\/example.com\/feedback\?token=abc&source=email/);
});

test('Brevo email delivery fails explicitly when credentials are missing or the API rejects a request', async () => {
  const originalFetch = global.fetch;
  const originalBrevoApiKey = process.env.BREVO_API_KEY;
  const originalEmailFrom = process.env.EMAIL_FROM;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    return { ok: false, status: 401, text: async () => 'Invalid API key' };
  };

  try {
    delete process.env.BREVO_API_KEY;
    process.env.EMAIL_FROM = 'verified@example.com';
    await assert.rejects(
      sendBrevoEmail({ to: 'customer@example.com', subject: 'Test', text: 'Test' }),
      /Set BREVO_API_KEY and a verified EMAIL_FROM/
    );
    assert.equal(fetchCalls, 0);

    process.env.BREVO_API_KEY = 'test-brevo-key';
    await assert.rejects(
      sendBrevoEmail({ to: 'customer@example.com', subject: 'Test', text: 'Test' }),
      /Brevo transactional email request failed \(401\)/
    );
    assert.equal(fetchCalls, 1);
  } finally {
    global.fetch = originalFetch;
    if (originalBrevoApiKey === undefined) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = originalBrevoApiKey;
    if (originalEmailFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = originalEmailFrom;
  }
});

test('direct messages and booking notices send branded HTML and text email alternatives', async () => {
  const originalFetch = global.fetch;
  const originalBrevoApiKey = process.env.BREVO_API_KEY;
  const originalEmailFrom = process.env.EMAIL_FROM;
  const sentEmails = [];
  process.env.BREVO_API_KEY = 'test-brevo-key';
  process.env.EMAIL_FROM = 'verified@example.com';
  global.fetch = async (url, options) => {
    sentEmails.push(JSON.parse(options.body));
    return { ok: true, status: 201 };
  };
  try {
    await sendMessageEmail({
      to: 'owner@example.com',
      sender: { name: 'Customer', email: 'customer@example.com', role: 'user' },
      context: 'Studio One',
      message: 'Hello, I have a question.',
    });
    await sendBookingRejectionEmail({
      to: 'customer@example.com',
      customerName: 'Customer',
      salonName: 'Studio One',
      reason: 'Customer did not arrive',
      feedbackUrl: 'https://example.com/feedback',
    });
    assert.match(sentEmails[0].subject, /New message about Studio One/);
    assert.match(sentEmails[0].htmlContent, /A personal message/);
    assert.match(sentEmails[1].subject, /update about your Studio One booking/i);
    assert.match(sentEmails[1].htmlContent, /Share your feedback/);
    assert.ok(sentEmails.every((email) => email.textContent && email.htmlContent && email.sender.name === 'SalonFlow'));
    assert.deepEqual(sentEmails[0].replyTo, { email: 'customer@example.com' });
  } finally {
    global.fetch = originalFetch;
    if (originalBrevoApiKey === undefined) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = originalBrevoApiKey;
    if (originalEmailFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = originalEmailFrom;
  }
});
