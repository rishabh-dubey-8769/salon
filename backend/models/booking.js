const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    salonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    appointmentDate: { type: String },
    appointmentTimeZone: { type: String, maxlength: 100, default: 'UTC' },
    salonSnapshot: {
      id: { type: String },
      name: { type: String },
      city: { type: String },
      address: { type: String },
      phone: { type: String },
    },
    services: {
      type: [
        {
          name: { type: String, required: true },
          category: { type: String, required: true },
          price: { type: Number, required: true, min: 0 },
          durationMinutes: { type: Number, required: true, min: 5 },
        },
      ],
      required: true,
    },
    total: { type: Number, required: true, min: 0 },
    paymentAmount: { type: Number, required: true, min: 0 },
    walletCreditUsed: { type: Number, min: 0, default: 0 },
    paymentMode: { type: String, enum: ['token', 'full'], required: true },
    paymentMethod: { type: String, enum: ['razorpay', 'upi_manual'], default: 'razorpay', index: true },
    paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending', index: true },
    upiPayeeId: { type: String, trim: true },
    upiPayeeName: { type: String, trim: true },
    upiReference: { type: String, trim: true, match: /^\d{12}$/ },
    paymentVerifiedAt: { type: Date },
    paymentVerifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    razorpayOrderId: { type: String, sparse: true, index: true },
    razorpayPaymentId: { type: String, sparse: true },
    paymentExpiresAt: { type: Date },
    priority: { type: String, enum: ['standard', 'express'], default: 'standard', index: true },
    expressFee: { type: Number, min: 0, default: 0 },
    queueSequence: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending_payment', 'waiting', 'in_service', 'completed', 'cancelled', 'rejected'],
      default: 'pending_payment',
      index: true,
    },
    estimatedWaitMinutes: { type: Number, min: 0, default: 0 },
    startedAt: { type: Date },
    completedAt: { type: Date },
    cancelledAt: { type: Date },
    rejectedAt: { type: Date },
    rejectionReasonCode: { type: String, trim: true, maxlength: 40 },
    rejectionReason: { type: String, trim: true, maxlength: 500 },
    rejectionFeedbackTokenHash: { type: String, select: false },
    rejectionFeedbackExpiresAt: { type: Date, select: false },
    rejectionFeedbackSubmittedAt: { type: Date },
    rejectionFeedback: { type: String, trim: true, maxlength: 500 },
    rejectionEmailSentAt: { type: Date },
  },
  { timestamps: true, versionKey: false }
);

bookingSchema.index({ salonId: 1, status: 1, priority: -1, queueSequence: 1 });
bookingSchema.index({ userId: 1, status: 1 });
bookingSchema.index({ userId: 1, createdAt: -1 });
bookingSchema.index({ salonId: 1, createdAt: -1 });
bookingSchema.index({ createdAt: -1, _id: -1 });
bookingSchema.index({ upiReference: 1 }, { unique: true, sparse: true });
bookingSchema.set('toJSON', {
  transform(_doc, value) {
    value.id = value._id.toString();
    delete value._id;
    return value;
  },
});

module.exports = mongoose.models.Booking || mongoose.model('Booking', bookingSchema);
