const nodemailer = require('nodemailer');

const MAX_ATTACHMENT_BYTES = 900_000;
const IMAGE_DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

const sendAdminContactMessage = async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message || message.length > 5000) {
      return res.status(400).json({ success: false, message: 'Describe your issue in 1 to 5000 characters.' });
    }

    let attachment;
    if (body.attachment !== undefined && body.attachment !== null) {
      const { dataUrl } = body.attachment;
      const match = typeof dataUrl === 'string' ? dataUrl.match(IMAGE_DATA_URL_PATTERN) : null;
      if (!match) {
        return res.status(400).json({ success: false, message: 'Upload a PNG, JPEG, or WebP image.' });
      }
      const content = Buffer.from(match[2], 'base64');
      if (!content.length || content.length > MAX_ATTACHMENT_BYTES) {
        return res.status(400).json({ success: false, message: 'The attached image must be smaller than 900 KB.' });
      }
      const signatureMatches = match[1] === 'image/png'
        ? content.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        : match[1] === 'image/jpeg'
          ? content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff
          : content.length >= 12
            && content.toString('ascii', 0, 4) === 'RIFF'
            && content.toString('ascii', 8, 12) === 'WEBP';
      if (!signatureMatches) {
        return res.status(400).json({ success: false, message: 'The attached file does not match its image format.' });
      }
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[match[1]];
      attachment = {
        filename: `salonflow-issue.${extension}`,
        content,
        contentType: match[1],
      };
    }

    const { ADMIN_EMAIL, GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_FROM } = process.env;
    if (!ADMIN_EMAIL || !GMAIL_USER || !GMAIL_APP_PASSWORD) {
      return res.status(503).json({ success: false, message: 'Admin email delivery is not configured. Please try again later.' });
    }

    const roleLabel = req.user.role === 'owner' ? 'Salon Owner Issue' : 'Customer issue';
    const senderUid = req.user.uid || 'Not assigned';
    const text = [
      `Type: ${roleLabel}`,
      `Name: ${req.user.name}`,
      `UID: ${senderUid}`,
      `Email: ${req.user.email || 'Not provided'}`,
      `Role: ${req.user.role}`,
      '',
      'Issue / feedback:',
      message,
    ].join('\n');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });
    await transporter.sendMail({
      from: { name: 'SalonFlow', address: EMAIL_FROM || GMAIL_USER },
      to: ADMIN_EMAIL,
      ...(req.user.email ? { replyTo: req.user.email } : {}),
      subject: `SalonFlow | ${roleLabel}`,
      text,
      ...(attachment ? { attachments: [attachment] } : {}),
    });

    return res.json({ success: true, message: 'Your message was sent to the admin.' });
  } catch (error) {
    return next(error);
  }
};

module.exports = { sendAdminContactMessage };
