const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema(
  {
    audience: {
      type: String,
      enum: ['customers', 'salon_owners', 'both'],
      required: true,
    },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    startsAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, versionKey: false }
);

announcementSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
announcementSchema.index({ startsAt: 1, expiresAt: 1 });
announcementSchema.set('toJSON', {
  transform(_doc, value) {
    value.id = value._id.toString();
    delete value._id;
    return value;
  },
});

module.exports = mongoose.models.Announcement || mongoose.model('Announcement', announcementSchema);
