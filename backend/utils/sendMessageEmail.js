const { buildMessageEmail } = require('./emailTemplates');
const sendBrevoEmail = require('./sendBrevoEmail');

const sendMessageEmail = async ({ to, sender, message, context }) => {
  const emailContent = buildMessageEmail({ sender, message, context });
  await sendBrevoEmail({
    to,
    ...(sender.email ? { replyTo: sender.email } : {}),
    ...emailContent,
  });
};

module.exports = sendMessageEmail;
