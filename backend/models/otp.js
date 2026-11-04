const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema(
  {
    contact: { type: String, required: true },
    purpose: { type: String, enum: ['register', 'reset_password'], required: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    verifiedAt: { type: Date },
    verificationTokenHash: { type: String },
    sentAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { versionKey: false }
);

otpSchema.index({ contact: 1, purpose: 1 }, { unique: true });

module.exports = mongoose.models.Otp || mongoose.model('Otp', otpSchema);
