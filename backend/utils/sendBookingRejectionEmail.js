const nodemailer = require('nodemailer');
const { buildRejectionEmail } = require('./emailTemplates');

const sendBookingRejectionEmail = async ({ to, customerName, salonName, reason, feedbackUrl }) => {
  const { GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_FROM } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    throw new Error('SalonFlow email is not configured.');
  }
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
  const emailContent = buildRejectionEmail({ customerName, salonName, reason, feedbackUrl });
  await transporter.sendMail({
    from: { name: 'SalonFlow', address: EMAIL_FROM || GMAIL_USER },
    to,
    ...emailContent,
  });
};

module.exports = sendBookingRejectionEmail;
