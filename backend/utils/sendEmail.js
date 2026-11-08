const nodemailer = require('nodemailer');

const sendEmail = async (email) => {
  const {
    RESEND_API_KEY,
    RESEND_FROM_EMAIL,
    GMAIL_USER,
    GMAIL_APP_PASSWORD,
  } = process.env;

  if (RESEND_API_KEY) {
    if (!RESEND_FROM_EMAIL) {
      throw new Error('RESEND_FROM_EMAIL must be set to a verified sender address.');
    }

    const payload = {
      from: `${email.from?.name || 'SalonFlow'} <${RESEND_FROM_EMAIL}>`,
      to: Array.isArray(email.to) ? email.to : [email.to],
      subject: email.subject,
      ...(email.replyTo ? { reply_to: email.replyTo } : {}),
      ...(email.text ? { text: email.text } : {}),
      ...(email.html ? { html: email.html } : {}),
      ...(email.attachments?.length ? {
        attachments: email.attachments.map((attachment) => ({
          filename: attachment.filename,
          content: Buffer.isBuffer(attachment.content)
            ? attachment.content.toString('base64')
            : attachment.content,
          ...(attachment.contentType ? { content_type: attachment.contentType } : {}),
        })),
      } : {}),
    };

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const providerMessage = result?.message || result?.name;
      throw new Error(`Email provider rejected the message (${response.status})${providerMessage ? `: ${providerMessage}` : '.'}`);
    }
    return result;
  }

  if (process.env.RENDER === 'true' && process.env.NODE_ENV === 'production') {
    throw new Error('Render production email requires RESEND_API_KEY and a verified RESEND_FROM_EMAIL; Gmail SMTP is not available on Render Free.');
  }
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    throw new Error('Email delivery is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL, or local Gmail SMTP credentials.');
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
  return transporter.sendMail(email);
};

module.exports = sendEmail;
