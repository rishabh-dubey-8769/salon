const { buildRejectionEmail } = require('./emailTemplates');
const sendBrevoEmail = require('./sendBrevoEmail');

const sendBookingRejectionEmail = async ({ to, customerName, salonName, reason, feedbackUrl }) => {
  const emailContent = buildRejectionEmail({ customerName, salonName, reason, feedbackUrl });
  await sendBrevoEmail({
    to,
    ...emailContent,
  });
};

module.exports = sendBookingRejectionEmail;
