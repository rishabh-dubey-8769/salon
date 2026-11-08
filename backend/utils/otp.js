const crypto = require('crypto');
const twilio = require('twilio');
const Otp = require('../models/otp');
const { buildOtpEmail } = require('./emailTemplates');
const deliverEmail = require('./sendEmail');

const createOtp = () => crypto.randomInt(100000, 1000000).toString();
const hashOtp = (code) =>
  crypto.createHmac('sha256', process.env.OTP_SECRET || process.env.JWT_SECRET).update(code).digest('hex');
const hashVerificationToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const sendSms = async (phone, code) => {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    throw new Error('SMS OTP is not configured. Set the Twilio credentials in the backend environment.');
  }
  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  await client.messages.create({
    body: `Your SalonFlow verification code is ${code}. It expires in 5 minutes. Never share it.`,
    from: TWILIO_FROM_NUMBER,
    to: phone,
  });
};

const deliverOtp = async (contact, code, purpose) => {
  if (contact.includes('@')) return sendEmail(contact, code, purpose);
  return sendSms(contact, code);
};

const sendEmail = async (email, code, purpose) => {
  const emailContent = buildOtpEmail({ code, purpose });
  const { EMAIL_FROM, GMAIL_USER } = process.env;
  await deliverEmail({
    from: { name: 'SalonFlow', address: EMAIL_FROM || GMAIL_USER || process.env.RESEND_FROM_EMAIL },
    to: email,
    ...emailContent,
  });
};

const issueOtp = async (contact, purpose) => {
  const now = new Date();
  const existing = await Otp.findOne({ contact, purpose });
  if (existing && now.getTime() - existing.sentAt.getTime() < 60_000) {
    const error = new Error('Please wait before requesting another code.');
    error.status = 429;
    throw error;
  }

  const code = createOtp();
  const codeHash = hashOtp(code);
  await Otp.findOneAndUpdate(
    { contact, purpose },
    {
      $set: { contact, purpose, codeHash, attempts: 0, sentAt: now, expiresAt: new Date(now.getTime() + 5 * 60_000) },
      $unset: { verifiedAt: 1, verificationTokenHash: 1 },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
  try {
    await deliverOtp(contact, code, purpose);
  } catch (error) {
    await Otp.deleteOne({ contact, purpose, codeHash });
    throw error;
  }
};

const verifyOtp = async (contact, purpose, code) => {
  const record = await Otp.findOne({ contact, purpose });
  if (!record || record.expiresAt <= new Date() || record.attempts >= 5) return false;

  const supplied = hashOtp(String(code));
  const expectedBuffer = Buffer.from(record.codeHash, 'hex');
  const suppliedBuffer = Buffer.from(supplied, 'hex');
  if (expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    await Otp.updateOne({ _id: record._id, verifiedAt: { $exists: false } }, { $inc: { attempts: 1 } });
    return null;
  }

  const verificationToken = crypto.randomBytes(32).toString('hex');
  const verified = await Otp.findOneAndUpdate(
    { _id: record._id, codeHash: record.codeHash, attempts: { $lt: 5 }, expiresAt: { $gt: new Date() } },
    { $set: { verifiedAt: new Date(), verificationTokenHash: hashVerificationToken(verificationToken) } },
    { new: true }
  );
  return verified ? verificationToken : null;
};

const consumeVerifiedOtp = async (contact, purpose, verificationToken) => {
  if (typeof verificationToken !== 'string' || !/^[a-f0-9]{64}$/.test(verificationToken)) return false;
  const record = await Otp.findOneAndDelete({
    contact,
    purpose,
    verifiedAt: { $type: 'date' },
    verificationTokenHash: hashVerificationToken(verificationToken),
    expiresAt: { $gt: new Date() },
    attempts: { $lt: 5 },
  });
  return Boolean(record);
};

module.exports = { issueOtp, verifyOtp, consumeVerifiedOtp };
