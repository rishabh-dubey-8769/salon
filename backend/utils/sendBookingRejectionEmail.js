const { buildRejectionEmail } = require('./emailTemplates');
const sendEmail = require('./sendEmail');

const sendBookingRejectionEmail = async ({ to, customerName, salonName, reason, feedbackUrl }) => {
  const emailContent = buildRejectionEmail({ customerName, salonName, reason, feedbackUrl });
  const { EMAIL_FROM, GMAIL_USER } = process.env;
  await sendEmail({
    from: { name: 'SalonFlow', address: EMAIL_FROM || GMAIL_USER || process.env.RESEND_FROM_EMAIL },
    to,
    ...emailContent,
  });
};

module.exports = sendBookingRejectionEmail;
