const { buildMessageEmail } = require('./emailTemplates');
const sendEmail = require('./sendEmail');

const sendMessageEmail = async ({ to, sender, message, context }) => {
  const emailContent = buildMessageEmail({ sender, message, context });
  const { EMAIL_FROM, GMAIL_USER } = process.env;
  await sendEmail({
    from: { name: 'SalonFlow', address: EMAIL_FROM || GMAIL_USER || process.env.RESEND_FROM_EMAIL },
    to,
    ...(sender.email ? { replyTo: sender.email } : {}),
    ...emailContent,
  });
};

module.exports = sendMessageEmail;
