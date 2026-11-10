const BREVO_EMAIL_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

const sendBrevoEmail = async ({ to, subject, text, html, replyTo, attachments }) => {
  const { BREVO_API_KEY, EMAIL_FROM } = process.env;
  if (!BREVO_API_KEY || !EMAIL_FROM) {
    throw new Error('Brevo email is not configured. Set BREVO_API_KEY and a verified EMAIL_FROM address.');
  }

  const payload = {
    sender: { name: 'SalonFlow', email: EMAIL_FROM },
    to: (Array.isArray(to) ? to : [to]).map((email) => ({ email })),
    subject,
    ...(text ? { textContent: text } : {}),
    ...(html ? { htmlContent: html } : {}),
    ...(replyTo ? { replyTo: { email: replyTo } } : {}),
    ...(attachments?.length
      ? {
          attachment: attachments.map(({ filename, content }) => ({
            name: filename,
            content: content.toString('base64'),
          })),
        }
      : {}),
  };

  const response = await fetch(BREVO_EMAIL_ENDPOINT, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': BREVO_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`Brevo transactional email request failed (${response.status})${details ? `: ${details}` : ''}`);
  }
};

module.exports = sendBrevoEmail;
