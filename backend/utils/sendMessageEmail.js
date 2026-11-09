const nodemailer = require('nodemailer');
const { buildMessageEmail } = require('./emailTemplates');

const sendMessageEmail = async ({ to, sender, message, context }) => {
  const { EMAIL_FROM, GMAIL_USER } = process.env;
  if (!GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    throw new Error('Email messaging is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in the backend environment.');
  }
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  const emailContent = buildMessageEmail({ sender, message, context });
  await transporter.sendMail({
    from: { name: 'SalonFlow', address: EMAIL_FROM || GMAIL_USER },
    to,
    ...(sender.email ? { replyTo: sender.email } : {}),
    ...emailContent,
  });
};

module.exports = sendMessageEmail;
