const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character]));

const renderEmailLayout = ({ preheader, content, footer }) => `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="margin:0;padding:0;background-color:#f2eff8;font-family:Arial,Helvetica,sans-serif;color:#29233a;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f2eff8;padding:36px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e7e1ef;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(48,31,76,.12);">
          <tr><td height="5" style="height:5px;background-color:#edaa58;background-image:linear-gradient(90deg,#f3bd64 0%,#e97882 48%,#8154bd 100%);font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr><td style="padding:24px 30px;background-color:#3a285d;background-image:linear-gradient(125deg,#33224f 0%,#563778 58%,#a3477c 100%);">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
              <td width="42" height="42" align="center" valign="middle" style="width:42px;height:42px;border:1px solid rgba(255,255,255,.32);border-radius:14px;background-color:#edaa58;background-image:linear-gradient(145deg,#f3c56b,#e88775);color:#39254f;font-size:22px;font-weight:700;">S</td>
              <td style="padding-left:12px;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-.4px;">SalonFlow<br><span style="color:#e8d8f6;font-size:11px;font-weight:400;letter-spacing:1.6px;text-transform:uppercase;">A little more you-time</span></td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:34px 32px 30px;background-color:#ffffff;">${content}</td></tr>
          <tr><td style="padding:18px 30px;background-color:#faf8fc;border-top:1px solid #eee9f3;color:#786e84;font-size:12px;line-height:1.6;">${footer}</td></tr>
        </table>
        <p style="margin:16px 0 0;color:#8f879c;font-size:11px;letter-spacing:.3px;">SalonFlow <span style="color:#d39a45;">✦</span> A little more time for the things you love.</p>
      </td></tr>
    </table>
  </body>
</html>`;

const buildOtpEmail = ({ code, purpose }) => {
  const isPasswordReset = purpose === 'reset_password';
  const subject = isPasswordReset
    ? 'SalonFlow | Your password reset code'
    : 'SalonFlow | Your email verification code';
  const action = isPasswordReset ? 'reset your password' : 'finish setting up your account';
  const codeDigits = Array.from(String(code), (digit, index) => {
    const colors = [
      ['#fff3e7', '#bd623e'],
      ['#f7eefc', '#74489b'],
      ['#fff0f2', '#b34d6d'],
      ['#edf4ff', '#456ba8'],
      ['#eef7f1', '#39775a'],
      ['#fff7e4', '#9c742c'],
    ];
    const [background, color] = colors[index % colors.length];
    return `<td width="34" height="50" align="center" valign="middle" style="width:34px;height:50px;border:1px solid #eee7f2;border-radius:11px;background-color:${background};color:${color};font-size:24px;font-weight:700;">${escapeHtml(digit)}</td>`;
  }).join('<td width="4" style="width:4px;font-size:0;">&nbsp;</td>');
  return {
    subject,
    text: `Your SalonFlow code to ${action} is ${code}. It expires in 5 minutes. Never share this code with anyone.`,
    html: renderEmailLayout({
      preheader: 'Your secure SalonFlow code is ready. It expires in five minutes.',
      content: `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 17px;"><tr><td style="padding:7px 11px;border:1px solid #eadcf6;border-radius:20px;background-color:#f7f0fc;color:#754b97;font-size:10px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;">${isPasswordReset ? 'Password reset' : 'Welcome to SalonFlow'}</td></tr></table>
        <h1 style="margin:0 0 9px;color:#302544;font-size:26px;line-height:1.25;letter-spacing:-.5px;">${isPasswordReset ? 'A fresh start, securely.' : 'Your sign-up, beautifully simple.'}</h1>
        <p style="margin:0 0 23px;color:#756b83;font-size:14px;line-height:1.65;">Enter this one-time code to ${action}.</p>
        <table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 20px;"><tr>${codeDigits}</tr></table>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #eee8f3;border-radius:12px;background-color:#faf8fc;"><tr><td style="padding:12px 15px;color:#71677c;font-size:12px;line-height:1.6;"><strong style="color:#533875;">Good to know</strong> &nbsp; Expires in 5 minutes. Never share this code with anyone.</td></tr></table>`,
      footer: 'Didn’t request this? You can safely ignore this email.',
    }),
  };
};

const cleanSubjectPart = (value) => String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 80);

const buildMessageEmail = ({ sender, message, context }) => {
  const safeContext = escapeHtml(context || 'your salon booking');
  const safeName = escapeHtml(sender.name || 'A SalonFlow user');
  const safeEmail = escapeHtml(sender.email || 'Email not provided');
  const safeRole = escapeHtml(sender.role || 'user');
  const safeMessage = escapeHtml(message);
  const heading = sender.role === 'owner'
    ? 'A message from your salon'
    : sender.role === 'admin'
      ? 'A message from SalonFlow support'
      : 'A note for your salon';
  return {
    subject: `SalonFlow | New message about ${cleanSubjectPart(context || 'your salon')}`,
    text: `A message about ${context || 'your salon booking'} from ${sender.name || 'a SalonFlow user'} (${sender.email || 'email not provided'}):\n\n${message}\n\nReply to this email to contact the sender.`,
    html: renderEmailLayout({
      preheader: `A new message about ${context || 'your salon booking'} from ${sender.name || 'a SalonFlow user'}.`,
      content: `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 15px;"><tr><td style="padding:7px 11px;border:1px solid #f5dfc2;border-radius:20px;background-color:#fff7e9;color:#9a6928;font-size:10px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;">A personal message</td></tr></table>
        <h1 style="margin:0 0 7px;color:#302544;font-size:24px;line-height:1.3;">${heading}</h1>
        <p style="margin:0 0 19px;color:#756b83;font-size:14px;line-height:1.6;">Regarding <strong style="color:#533875;">${safeContext}</strong></p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:15px;border:1px solid #eee8f3;border-radius:12px;background-color:#faf8fc;">
          <tr><td style="padding:13px 15px;color:#71677c;font-size:13px;line-height:1.6;"><strong style="color:#302544;">${safeName}</strong> <span style="color:#a397b2;">· ${safeRole}</span><br>${safeEmail}</td></tr>
        </table>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #f2e5d4;border-radius:12px;background-color:#fffaf3;"><tr><td style="padding:17px 18px;border-left:4px solid #dc8c61;color:#51465c;font-size:14px;line-height:1.75;overflow-wrap:anywhere;">${safeMessage.replace(/\r?\n/g, '<br>')}</td></tr></table>
        <p style="margin:18px 0 0;color:#756b83;font-size:13px;line-height:1.6;">Simply reply to this email to continue the conversation.</p>`,
      footer: 'Sent with care through SalonFlow.',
    }),
  };
};

const buildRejectionEmail = ({ customerName, salonName, reason, feedbackUrl }) => {
  const safeName = escapeHtml(customerName || 'customer');
  const safeSalon = escapeHtml(salonName || 'the salon');
  const safeReason = escapeHtml(reason);
  const safeFeedbackUrl = escapeHtml(feedbackUrl);
  return {
    subject: `SalonFlow | An update about your ${cleanSubjectPart(salonName || 'salon')} booking`,
    text: [
      `Hello ${customerName || 'there'},`,
      '',
      `Your booking at ${salonName || 'the salon'} was rejected and removed from its queue.`,
      `Reason: ${reason}`,
      '',
      'Share feedback using this secure link:',
      feedbackUrl,
      '',
      'The link expires in 30 days and can be used once.',
    ].join('\n'),
    html: renderEmailLayout({
      preheader: `An update about your booking at ${salonName || 'the salon'}.`,
      content: `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 15px;"><tr><td style="padding:7px 11px;border:1px solid #f5dfc2;border-radius:20px;background-color:#fff7e9;color:#9a6928;font-size:10px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;">Booking update</td></tr></table>
        <h1 style="margin:0 0 10px;color:#302544;font-size:24px;line-height:1.3;">Hello ${safeName}</h1>
        <p style="margin:0 0 17px;color:#756b83;font-size:14px;line-height:1.65;">There’s an update about your booking at <strong style="color:#533875;">${safeSalon}</strong>.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #f2dfd8;border-radius:12px;background-color:#fff7f4;"><tr><td style="padding:15px 17px;border-left:4px solid #d56f76;color:#65505d;font-size:14px;line-height:1.65;"><strong style="color:#8f3f5b;">Reason</strong><br>${safeReason}</td></tr></table>
        <p style="margin:21px 0;"><a href="${safeFeedbackUrl}" style="display:inline-block;padding:13px 20px;border:1px solid #70468f;border-radius:10px;background-color:#63407f;background-image:linear-gradient(110deg,#5b397a,#9b4e83);color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">Share your feedback&nbsp; &rarr;</a></p>
        <p style="margin:0;color:#756b83;font-size:12px;line-height:1.6;">Your private feedback link expires in 30 days and works once.</p>`,
      footer: 'You received this message because you have a SalonFlow booking.',
    }),
  };
};

module.exports = { buildOtpEmail, buildMessageEmail, buildRejectionEmail, escapeHtml, renderEmailLayout };
