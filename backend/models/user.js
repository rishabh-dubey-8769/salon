const mongoose = require('mongoose');
const { generateAccountUid } = require('../utils/accountUid');

const userSchema = new mongoose.Schema(
  {
    uid: { type: String, unique: true, sparse: true, immutable: true, match: /^[CS]\d{24}$/ },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
    phone: { type: String, trim: true, unique: true, sparse: true },
    contactPhone: { type: String, trim: true, maxlength: 16 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['user', 'owner', 'admin'], default: 'user' },
    gender: { type: String, trim: true, maxlength: 30 },
    dateOfBirth: { type: Date },
    profileImage: { type: String, maxlength: 1200000 },
    location: {
      label: { type: String, trim: true, maxlength: 160 },
      lat: { type: Number, min: -90, max: 90 },
      lng: { type: Number, min: -180, max: 180 },
      pinCode: { type: String, trim: true, maxlength: 20 },
    },
    activeBookingCount: { type: Number, min: 0, default: 0, select: false },
    walletCredits: { type: Number, min: 0, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false }
);

userSchema.pre('validate', function assignAccountUid() {
  if (this.isNew && ['user', 'owner'].includes(this.role) && !this.uid) {
    this.uid = generateAccountUid(this.role);
  }
});

userSchema.set('toJSON', {
  transform(_doc, value) {
    value.id = value._id.toString();
    delete value._id;
    delete value.passwordHash;
    delete value.uid;
    return value;
  },
});

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
