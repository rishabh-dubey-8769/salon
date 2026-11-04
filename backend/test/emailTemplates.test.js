const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const Otp = require('../models/otp');
const { issueOtp } = require('../utils/otp');
const sendMessageEmail = require('../utils/sendMessageEmail');
const sendBookingRejectionEmail = require('../utils/sendBookingRejectionEmail');
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
  const originalCreateTransport = nodemailer.createTransport;
  const originalFind = Otp.findOne;
  const originalUpdate = Otp.findOneAndUpdate;
  const originalDelete = Otp.deleteOne;
  const originalSecret = process.env.OTP_SECRET;
  const originalGmailUser = process.env.GMAIL_USER;
  const originalGmailPassword = process.env.GMAIL_APP_PASSWORD;
  const sentEmails = [];
  process.env.OTP_SECRET = 'test-secret-for-email-template-validation';
  process.env.GMAIL_USER = 'test@example.com';
  process.env.GMAIL_APP_PASSWORD = 'mock-password';
  Otp.findOne = async () => null;
  Otp.findOneAndUpdate = async () => ({});
  Otp.deleteOne = async () => ({ deletedCount: 0 });
  nodemailer.createTransport = () => ({
    sendMail: async (email) => sentEmails.push(email),
  });
  try {
    await issueOtp('signup@example.com', 'register');
    await issueOtp('reset@example.com', 'reset_password');
    assert.equal(sentEmails[0].subject, 'SalonFlow | Your email verification code');
    assert.equal(sentEmails[1].subject, 'SalonFlow | Your password reset code');
    assert.match(sentEmails[0].html, /Your sign-up, beautifully simple\./);
    assert.match(sentEmails[1].html, /A fresh start, securely\./);
    assert.match(sentEmails[0].from.name, /SalonFlow/);
    assert.ok(sentEmails.every((email) => email.text && email.html));
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    Otp.findOne = originalFind;
    Otp.findOneAndUpdate = originalUpdate;
    Otp.deleteOne = originalDelete;
    if (originalSecret === undefined) delete process.env.OTP_SECRET;
    else process.env.OTP_SECRET = originalSecret;
    if (originalGmailUser === undefined) delete process.env.GMAIL_USER;
    else process.env.GMAIL_USER = originalGmailUser;
    if (originalGmailPassword === undefined) delete process.env.GMAIL_APP_PASSWORD;
    else process.env.GMAIL_APP_PASSWORD = originalGmailPassword;
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

test('direct messages and booking notices send branded HTML and text email alternatives', async () => {
  const originalCreateTransport = nodemailer.createTransport;
  const originalGmailUser = process.env.GMAIL_USER;
  const originalGmailPassword = process.env.GMAIL_APP_PASSWORD;
  const sentEmails = [];
  process.env.GMAIL_USER = 'test@example.com';
  process.env.GMAIL_APP_PASSWORD = 'mock-password';
  nodemailer.createTransport = () => ({
    sendMail: async (email) => sentEmails.push(email),
  });
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
    assert.match(sentEmails[0].html, /A personal message/);
    assert.match(sentEmails[1].subject, /update about your Studio One booking/i);
    assert.match(sentEmails[1].html, /Share your feedback/);
    assert.ok(sentEmails.every((email) => email.text && email.html && email.from.name === 'SalonFlow'));
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    if (originalGmailUser === undefined) delete process.env.GMAIL_USER;
    else process.env.GMAIL_USER = originalGmailUser;
    if (originalGmailPassword === undefined) delete process.env.GMAIL_APP_PASSWORD;
    else process.env.GMAIL_APP_PASSWORD = originalGmailPassword;
  }
});
