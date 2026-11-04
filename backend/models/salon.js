const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    category: { type: String, required: true, trim: true, maxlength: 40 },
    price: { type: Number, required: true, min: 0 },
    durationMinutes: { type: Number, required: true, min: 5, max: 300, default: 30 },
  },
  { _id: true }
);

const salonSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    address: { type: String, required: true, trim: true, maxlength: 200 },
    phone: { type: String, trim: true, maxlength: 20 },
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
    pinCode: { type: String, trim: true, maxlength: 20 },
    rating: { type: Number, min: 0, max: 5, default: 0 },
    isOpen: { type: Boolean, default: false },
    isApproved: { type: Boolean, default: false, index: true },
    isActive: { type: Boolean, default: true },
    queuePaused: { type: Boolean, default: false },
    queueCounter: { type: Number, default: 0 },
    blockedCustomerIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      default: [],
      select: false,
    },
    services: { type: [serviceSchema], validate: [(items) => items.length > 0, 'At least one service is required'] },
    image: { type: String, trim: true },
    images: { type: [String], default: [] },
  },
  { timestamps: true, versionKey: false }
);

salonSchema.set('toJSON', {
  transform(_doc, value) {
    value.id = value._id.toString();
    delete value._id;
    delete value.queueCounter;
    delete value.blockedCustomerIds;
    return value;
  },
});

module.exports = mongoose.models.Salon || mongoose.model('Salon', salonSchema);
