const mongoose = require('mongoose');

const ratingSchema = new mongoose.Schema(
  {
    salonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    value: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
  },
  { timestamps: true, versionKey: false }
);

ratingSchema.index({ salonId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.models.Rating || mongoose.model('Rating', ratingSchema);
