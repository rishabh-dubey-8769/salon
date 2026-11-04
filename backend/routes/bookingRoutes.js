const express = require('express');
const {
  createBooking,
  submitUpiReference,
  verifyBookingPayment,
  getUserBookings,
  getBookingHistory,
  getSalonQueue,
  updateQueueBooking,
  retryBookingRejectionEmail,
  getRejectionFeedbackDetails,
  submitRejectionFeedback,
  cancelMyBooking,
} = require('../controllers/bookingController');
const { protect, requireRole } = require('../middleware/authMiddleware');
const { messageBookingCustomer } = require('../controllers/messageController');
const rateLimit = require('express-rate-limit');
const { buildReport, asCsv } = require('../utils/report');

const router = express.Router();
const messageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
const paymentReferenceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
const rejectionFeedbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

router.get('/rejection-feedback', rejectionFeedbackLimiter, getRejectionFeedbackDetails);
router.post('/rejection-feedback', rejectionFeedbackLimiter, submitRejectionFeedback);
router.use(protect);
router.post('/', createBooking);
router.get('/history', getBookingHistory);
router.post('/:id/upi-reference', paymentReferenceLimiter, submitUpiReference);
router.get('/my-bookings', getUserBookings);
router.get('/owner/report', requireRole('owner'), async (req, res, next) => {
  try {
    const report = await buildReport({ query: req.query, ownerId: req.user.id });
    return res.json({ success: true, report });
  } catch (error) {
    if (error.message.startsWith('Invalid') || error.message.startsWith('Period') || error.message.startsWith('The from')) {
      error.status = 400;
    }
    return next(error);
  }
});
router.get('/owner/report.csv', requireRole('owner'), async (req, res, next) => {
  try {
    const report = await buildReport({ query: req.query, ownerId: req.user.id });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="salonflow-owner-activity.csv"');
    return res.send(asCsv(report));
  } catch (error) {
    if (error.message.startsWith('Invalid') || error.message.startsWith('Period') || error.message.startsWith('The from')) {
      error.status = 400;
    }
    return next(error);
  }
});
router.get('/owner/:salonId/queue', requireRole('owner'), getSalonQueue);
router.post('/:id/verify-payment', verifyBookingPayment);
router.post('/:id/cancel', cancelMyBooking);
router.post('/:id/message', messageLimiter, messageBookingCustomer);
router.patch('/:id/status', requireRole('owner'), updateQueueBooking);
router.post('/:id/rejection-email', requireRole('owner'), retryBookingRejectionEmail);

module.exports = router;
