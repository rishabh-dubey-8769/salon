const mongoose = require('mongoose');
const crypto = require('crypto');
const Booking = require('../models/booking');
const Salon = require('../models/salon');
const User = require('../models/user');
const { createOrder, fetchPayment, verifyCheckoutSignature } = require('../utils/payment');
const { queueForSalon, refreshWaitEstimates } = require('../utils/queue');
const {
  isAppointmentDateAvailable,
  isValidAppointmentDate,
  isValidTimeZone,
  localDateTimeToUtc,
} = require('../utils/appointmentDate');
const { getUpiConfig, createUpiPaymentDetails, getUpiAdvanceAmount } = require('../utils/upiPayment');
const sendBookingRejectionEmail = require('../utils/sendBookingRejectionEmail');

const rejectionReasonLabels = {
  no_show: 'Customer did not arrive',
  late_arrival: 'Customer arrived after their queue slot',
  declined_service: 'Customer declined the service',
  payment_issue: 'Customer could not complete payment',
  other: 'Other',
};
const feedbackOptions = [
  'I could not arrive on time',
  'I was unable to attend',
  'I had a payment issue',
  'Other',
];

const sendRejectionEmail = async (booking, salon, customer) => {
  if (!customer?.email) {
    return { sent: false, warning: 'The booking was rejected, but the customer has no email address on their account.' };
  }
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const frontendOrigin = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim();
  const feedbackUrl = new URL('/', `${frontendOrigin.replace(/\/+$/, '')}/`);
  feedbackUrl.searchParams.set('rejection-feedback', token);

  await Booking.updateOne(
    { _id: booking._id, status: 'rejected' },
    {
      $set: {
        rejectionFeedbackTokenHash: tokenHash,
        rejectionFeedbackExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    }
  );
  await sendBookingRejectionEmail({
    to: customer.email,
    customerName: customer.name,
    salonName: salon.name,
    reason: booking.rejectionReason,
    feedbackUrl: feedbackUrl.toString(),
  });
  await Booking.updateOne(
    { _id: booking._id, status: 'rejected', rejectionFeedbackTokenHash: tokenHash },
    { $set: { rejectionEmailSentAt: new Date() } }
  );
  return { sent: true };
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const releaseBookingSlot = (userId, creditToRestore = 0) => User.updateOne(
  { _id: userId, activeBookingCount: { $gt: 0 } },
  { $inc: { activeBookingCount: -1, walletCredits: creditToRestore } }
);

const createBooking = async (req, res, next) => {
  let slotReserved = false;
  let booking;
  try {
    const {
      salonId,
      serviceIds,
      priority = 'standard',
      appointmentDate,
      appointmentTimeZone = 'UTC',
    } = req.body;
    if (!mongoose.isValidObjectId(salonId) || !Array.isArray(serviceIds) || serviceIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Choose a salon and at least one service.' });
    }
    if (!['standard', 'express'].includes(priority)) {
      return res.status(400).json({ success: false, message: 'Invalid booking priority.' });
    }
    const { payeeAddress, payeeName } = getUpiConfig();
    if (!isValidTimeZone(appointmentTimeZone) || !isAppointmentDateAvailable(appointmentDate, appointmentTimeZone)) {
      return res.status(400).json({ success: false, message: 'Choose a valid appointment date today or later.' });
    }

    const salon = await Salon.findOne({ _id: salonId, isApproved: true, isActive: true, isOpen: true, queuePaused: false })
      .select('+blockedCustomerIds');
    if (!salon) return res.status(400).json({ success: false, message: 'This salon is closed or not accepting online bookings.' });
    if (salon.blockedCustomerIds.some((customerId) => customerId.equals(req.user._id))) {
      return res.status(403).json({ success: false, message: 'This salon is not accepting new bookings from your account.' });
    }

    const chosenServices = salon.services.filter((service) => serviceIds.includes(service._id.toString()));
    if (!chosenServices.length || chosenServices.length !== new Set(serviceIds).size) {
      return res.status(400).json({ success: false, message: 'One or more selected services are unavailable.' });
    }

    const total = chosenServices.reduce((sum, service) => sum + service.price, 0);
    const paymentAmount = getUpiAdvanceAmount(priority);
    const expressFee = priority === 'express' ? paymentAmount : 0;
    const user = await User.findOneAndUpdate(
      { _id: req.user.id, activeBookingCount: { $lt: 2 } },
      { $inc: { activeBookingCount: 1 } },
      { new: true }
    );
    if (!user) return res.status(429).json({ success: false, message: 'You can have at most 2 active bookings across the platform.' });
    slotReserved = true;

    const updatedSalon = await Salon.findByIdAndUpdate(salon._id, { $inc: { queueCounter: 1 } }, { new: true });

    booking = await Booking.create({
      userId: req.user.id,
      salonId: salon._id,
      appointmentDate,
      appointmentTimeZone,
      salonSnapshot: {
        id: salon._id.toString(),
        name: salon.name,
        city: salon.city,
        address: salon.address,
        phone: salon.phone,
      },
      services: chosenServices.map((service) => ({
        name: service.name,
        category: service.category,
        price: service.price,
        durationMinutes: service.durationMinutes,
      })),
      total,
      paymentAmount,
      walletCreditUsed: 0,
      paymentMode: 'token',
      paymentMethod: 'upi_manual',
      priority,
      expressFee,
      upiPayeeId: payeeAddress,
      upiPayeeName: payeeName,
      queueSequence: updatedSalon.queueCounter,
    });

    return res.status(201).json({
      success: true,
      message: 'Booking created. Pay the advance and submit the UPI reference for verification.',
      booking,
      payment: createUpiPaymentDetails({
        bookingId: booking.id,
        amount: paymentAmount,
        payeeAddress,
        payeeName,
      }),
    });
  } catch (error) {
    if (booking) await Booking.deleteOne({ _id: booking._id });
    if (slotReserved) {
      await releaseBookingSlot(req.user.id, booking?.walletCreditUsed || 0);
    }
    return next(error);
  }
};

const submitUpiReference = async (req, res, next) => {
  try {
    const upiReference = typeof req.body.upiReference === 'string' ? req.body.upiReference.trim() : '';
    if (!/^\d{12}$/.test(upiReference)) {
      return res.status(400).json({ success: false, message: 'Enter the 12-digit UPI reference number from your payment app.' });
    }
    const booking = await Booking.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: req.user.id,
        paymentMethod: 'upi_manual',
        upiReference: { $exists: false },
        $or: [
          { paymentStatus: 'pending', status: 'pending_payment' },
          {
            paymentStatus: 'paid',
            status: { $in: ['waiting', 'in_service', 'completed'] },
            paymentVerifiedAt: { $exists: true },
          },
        ],
      },
      { $set: { upiReference } },
      { new: true, runValidators: true }
    );
    if (!booking) {
      return res.status(409).json({ success: false, message: 'This booking is not awaiting a UPI reference, or a reference was already submitted.' });
    }
    return res.json({
      success: true,
      message: booking.paymentStatus === 'paid'
        ? 'Reference added to the booking. The administrator had already confirmed the payment.'
        : 'Reference submitted. Your booking stays pending until an administrator verifies the payment in the bank account.',
      booking,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'This UPI reference has already been submitted for another booking.' });
    }
    return next(error);
  }
};

const verifyBookingPayment = async (req, res, next) => {
  try {
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body;
    if (!verifyCheckoutSignature(orderId, paymentId, signature)) {
      return res.status(400).json({ success: false, message: 'Payment signature could not be verified.' });
    }
    const booking = await Booking.findOne({
      _id: req.params.id,
      userId: req.user.id,
      razorpayOrderId: orderId,
      status: 'pending_payment',
      paymentExpiresAt: { $gt: new Date() },
    });
    if (!booking) return res.status(404).json({ success: false, message: 'Payment session expired or booking not found.' });

    const payment = await fetchPayment(paymentId);
    if (
      payment.order_id !== orderId ||
      payment.status !== 'captured' ||
      payment.amount !== Math.round(booking.paymentAmount * 100)
    ) {
      return res.status(400).json({ success: false, message: 'Payment is not captured for the expected amount.' });
    }

    const confirmedBooking = await Booking.findOneAndUpdate(
      {
        _id: booking._id,
        userId: req.user.id,
        status: 'pending_payment',
        paymentExpiresAt: { $gt: new Date() },
      },
      {
        $set: {
          razorpayPaymentId: paymentId,
          paymentStatus: 'paid',
          status: 'waiting',
        },
        $unset: { paymentExpiresAt: 1 },
      },
      { new: true, runValidators: true }
    );
    if (!confirmedBooking) {
      return res.status(409).json({ success: false, message: 'This payment session was already processed or expired.' });
    }
    const queue = await refreshWaitEstimates(confirmedBooking.salonId);
    const queuedBooking = queue.find((item) => item.id === confirmedBooking.id);
    return res.json({ success: true, message: 'Booking confirmed.', booking: queuedBooking || confirmedBooking });
  } catch (error) {
    return next(error);
  }
};

const getUserBookings = async (req, res, next) => {
  try {
    const paginated = req.query.page !== undefined || req.query.limit !== undefined;
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = paginated
      ? Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10))
      : 50;
    let bookingsQuery = Booking.find({ userId: req.user.id })
      .populate('salonId', 'name address city phone')
      .sort({ createdAt: -1 })
      .limit(limit);
    if (paginated) bookingsQuery = bookingsQuery.skip((page - 1) * limit);
    const [bookings, total] = await Promise.all([
      bookingsQuery,
      Booking.countDocuments({ userId: req.user.id }),
    ]);
    const currentBookings = await Promise.all(bookings.map(async (booking) => {
      if (
        booking.paymentMethod !== 'upi_manual' ||
        booking.paymentStatus !== 'pending' ||
        booking.status !== 'pending_payment' ||
        booking.upiReference ||
        booking.paymentAmount === getUpiAdvanceAmount(booking.priority)
      ) {
        return booking;
      }

      const paymentAmount = getUpiAdvanceAmount(booking.priority);
      const updatedBooking = await Booking.findOneAndUpdate(
        {
          _id: booking._id,
          paymentMethod: 'upi_manual',
          paymentStatus: 'pending',
          status: 'pending_payment',
          upiReference: { $exists: false },
        },
        { $set: { paymentAmount, expressFee: booking.priority === 'express' ? paymentAmount : 0 } },
        { new: true, runValidators: true }
      ).populate('salonId', 'name address city phone');
      return updatedBooking || Booking.findById(booking._id).populate('salonId', 'name address city phone');
    }));
    const activeSalonIds = [...new Set(
      currentBookings
        .filter((booking) => booking && ['waiting', 'in_service'].includes(booking.status))
        .map((booking) => booking.salonId?._id?.toString())
        .filter(Boolean)
    )];
    const queues = await Promise.all(activeSalonIds.map(async (salonId) => [
      salonId,
      await queueForSalon(salonId),
    ]));
    const queueBySalon = new Map(queues);
    const result = currentBookings.filter(Boolean).map((booking) => {
      const current = queueBySalon.get(booking.salonId?._id?.toString())
        ?.find((item) => item.id === booking.id);
      const upiPayment = booking.paymentMethod === 'upi_manual' &&
        booking.status === 'pending_payment' &&
        booking.paymentStatus === 'pending'
        ? createUpiPaymentDetails({
          bookingId: booking.id,
          amount: booking.paymentAmount,
          payeeAddress: booking.upiPayeeId,
          payeeName: booking.upiPayeeName,
        })
        : null;
      return {
        ...booking.toJSON(),
        userUid: req.user.uid,
        ...(upiPayment ? { upiPayment } : {}),
        ...(current ? {
          queuePosition: current.queuePosition,
          estimatedWaitMinutes: current.estimatedWaitMinutes,
        } : {}),
      };
    });
    return res.json({
      success: true,
      bookings: result,
      serverTime: new Date().toISOString(),
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      total,
    });
  } catch (error) {
    return next(error);
  }
};

const getBookingHistory = async (req, res, next) => {
  try {
    const isCustomer = ['user', 'customer'].includes(req.user.role);
    if (!isCustomer && !['owner', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to view booking history.' });
    }
    const {
      fromDate,
      toDate,
      fromTime,
      toTime,
      salon: salonSearch,
      status,
      timeZone = 'UTC',
    } = req.query;
    if (
      (fromDate && !isValidAppointmentDate(fromDate)) ||
      (toDate && !isValidAppointmentDate(toDate))
    ) {
      return res.status(400).json({ success: false, message: 'Date filters must be valid calendar dates.' });
    }
    if (fromDate && toDate && fromDate > toDate) {
      return res.status(400).json({ success: false, message: 'The start date must be on or before the end date.' });
    }
    if (
      (fromTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(fromTime)) ||
      (toTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(toTime))
    ) {
      return res.status(400).json({ success: false, message: 'Time filters must use a valid 24-hour time.' });
    }
    if (!isValidTimeZone(timeZone)) {
      return res.status(400).json({ success: false, message: 'Invalid time zone.' });
    }
    if (status && !['pending_payment', 'waiting', 'in_service', 'completed', 'cancelled', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid booking status filter.' });
    }

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const query = {};
    if (isCustomer) query.userId = req.user._id;
    if (req.user.role === 'owner') {
      const ownerSalons = await Salon.find({ ownerId: req.user._id }).select('_id').lean();
      if (!ownerSalons.length) {
        return res.json({ success: true, bookings: [], page, pages: 1, total: 0 });
      }
      query.salonId = { $in: ownerSalons.map((salon) => salon._id) };
    }
    if (status) query.status = status;

    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = localDateTimeToUtc(fromDate, '00:00', timeZone);
      if (toDate) {
        const nextDay = new Date(`${toDate}T00:00:00.000Z`);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        query.createdAt.$lt = localDateTimeToUtc(nextDay.toISOString().slice(0, 10), '00:00', timeZone);
      }
    }

    const search = typeof salonSearch === 'string' ? salonSearch.trim().slice(0, 100) : '';
    if (search) {
      const matchingSalons = await Salon.find({
        name: { $regex: escapeRegex(search), $options: 'i' },
        ...(req.user.role === 'owner' ? { ownerId: req.user._id } : {}),
      }).select('_id').lean();
      if (req.user.role === 'owner') {
        query.salonId = { $in: matchingSalons.map((salon) => salon._id) };
      } else {
        query.$or = [
          { salonId: { $in: matchingSalons.map((salon) => salon._id) } },
          { 'salonSnapshot.name': { $regex: escapeRegex(search), $options: 'i' } },
        ];
      }
    }

    if (fromTime || toTime) {
      const localTime = { $dateToString: { format: '%H:%M', date: '$createdAt', timezone: timeZone } };
      if (fromTime && toTime && fromTime > toTime) {
        query.$expr = {
          $or: [
            { $gte: [localTime, fromTime] },
            { $lte: [localTime, toTime] },
          ],
        };
      } else {
        const bounds = [];
        if (fromTime) bounds.push({ $gte: [localTime, fromTime] });
        if (toTime) bounds.push({ $lte: [localTime, toTime] });
        query.$expr = bounds.length === 1 ? bounds[0] : { $and: bounds };
      }
    }

    let bookingsQuery = Booking.find(query)
      .populate('salonId', 'name city address ownerId')
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
    if (!isCustomer) {
      bookingsQuery = bookingsQuery.populate('userId', 'uid name email phone contactPhone');
    }
    if (req.user.role === 'admin') {
      bookingsQuery = bookingsQuery.populate({ path: 'salonId', select: 'name city address ownerId', populate: { path: 'ownerId', select: 'uid name email' } });
    }
    const [bookings, total] = await Promise.all([
      bookingsQuery.lean(),
      Booking.countDocuments(query),
    ]);
    return res.json({
      success: true,
      bookings: bookings.map((booking) => ({
        ...booking,
        ...(isCustomer ? { userUid: req.user.uid } : {}),
        ...(req.user.role === 'owner' ? { ownerUid: req.user.uid } : {}),
      })),
      serverTime: new Date().toISOString(),
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      total,
    });
  } catch (error) {
    return next(error);
  }
};

const getSalonQueue = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.salonId)) {
      return res.status(400).json({ success: false, message: 'Invalid salon id.' });
    }
    const salon = await Salon.findOne({ _id: req.params.salonId, ownerId: req.user.id })
      .select('+blockedCustomerIds');
    if (!salon) return res.status(404).json({ success: false, message: 'Salon not found.' });
    const queue = await refreshWaitEstimates(salon._id);
    const bookings = await Booking.find({ salonId: salon._id })
      .populate('userId', 'name email contactPhone uid')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    const blockedCustomerIds = new Set(salon.blockedCustomerIds.map((id) => id.toString()));
    const blockedCustomers = await User.find({ _id: { $in: [...blockedCustomerIds] }, role: 'user' })
      .select('name email contactPhone uid')
      .lean();
    return res.json({
      success: true,
      salon,
      serverTime: new Date().toISOString(),
      blockedCustomers: blockedCustomers.map((customer) => ({
        ...customer,
        id: customer._id.toString(),
      })),
      queue: queue.map((booking) => ({
        ...booking,
        customerBlocked: blockedCustomerIds.has(booking.user?._id?.toString()),
      })),
      bookings: bookings.map((booking) => ({
        ...booking,
        customerBlocked: blockedCustomerIds.has(booking.userId?._id?.toString()),
      })),
      accountUid: req.user.uid,
    });
  } catch (error) {
    return next(error);
  }
};

const updateQueueBooking = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['in_service', 'completed', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Unsupported queue action.' });
    }
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid booking id.' });
    }
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found.' });
    const salon = await Salon.findOne({ _id: booking.salonId, ownerId: req.user.id });
    if (!salon) return res.status(403).json({ success: false, message: 'This booking does not belong to your salon.' });
    const allowed = status === 'in_service'
      ? booking.status === 'waiting'
      : status === 'completed'
        ? booking.status === 'in_service'
        : booking.status === 'waiting';
    if (!allowed) return res.status(409).json({ success: false, message: 'Booking cannot make that queue transition.' });
    if (status === 'in_service') {
      const currentQueue = await queueForSalon(booking.salonId);
      const firstWaiting = currentQueue.find((item) => item.status === 'waiting');
      if (!firstWaiting || firstWaiting.id !== booking.id) {
        return res.status(409).json({ success: false, message: 'Serve the next customer in the queue first.' });
      }
    }

    const now = new Date();
    const changes = { status };
    if (status === 'in_service') changes.startedAt = now;
    if (status === 'completed') changes.completedAt = now;
    let rejectionReason;
    if (status === 'rejected') {
      const { rejectionReasonCode, rejectionDetails = '' } = req.body;
      if (!Object.hasOwn(rejectionReasonLabels, rejectionReasonCode)) {
        return res.status(400).json({ success: false, message: 'Choose a valid reason for rejecting this booking.' });
      }
      if (typeof rejectionDetails !== 'string' || rejectionDetails.trim().length > 500) {
        return res.status(400).json({ success: false, message: 'Additional details must be 500 characters or fewer.' });
      }
      const details = rejectionDetails.trim();
      if (rejectionReasonCode === 'other' && !details) {
        return res.status(400).json({ success: false, message: 'Add a short explanation for the selected “Other” reason.' });
      }
      rejectionReason = rejectionReasonLabels[rejectionReasonCode] + (details ? `: ${details}` : '');
      changes.rejectedAt = now;
      changes.rejectionReasonCode = rejectionReasonCode;
      changes.rejectionReason = rejectionReason;
    }
    const updatedBooking = await Booking.findOneAndUpdate(
      { _id: booking._id, salonId: salon._id, status: booking.status },
      { $set: changes },
      { new: true, runValidators: true }
    );
    if (!updatedBooking) return res.status(409).json({ success: false, message: 'Booking queue changed. Refresh and try again.' });
    if (status === 'completed' || status === 'rejected') {
      await releaseBookingSlot(booking.userId, status === 'rejected' ? booking.walletCreditUsed : 0);
    }
    const queue = await refreshWaitEstimates(booking.salonId);
    if (status === 'rejected') {
      try {
        const customer = await User.findById(booking.userId).select('name email');
        const email = await sendRejectionEmail(updatedBooking, salon, customer);
        return res.json({
          success: true,
          booking: updatedBooking,
          queue,
          emailSent: email.sent,
          ...(email.warning ? { warning: email.warning } : {}),
        });
      } catch {
        return res.json({
          success: true,
          booking: updatedBooking,
          queue,
          emailSent: false,
          warning: 'The booking was rejected, but the customer email could not be sent. Check the email settings and retry from booking history.',
        });
      }
    }
    return res.json({ success: true, booking: updatedBooking, queue });
  } catch (error) {
    return next(error);
  }
};

const retryBookingRejectionEmail = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid booking id.' });
    }
    const booking = await Booking.findOne({ _id: req.params.id, status: 'rejected' });
    if (!booking) return res.status(404).json({ success: false, message: 'Rejected booking not found.' });
    const salon = await Salon.findOne({ _id: booking.salonId, ownerId: req.user.id });
    if (!salon) return res.status(403).json({ success: false, message: 'This booking does not belong to your salon.' });
    const customer = await User.findById(booking.userId).select('name email');
    if (!customer?.email) {
      return res.status(409).json({ success: false, message: 'The customer has no email address on their account.' });
    }
    try {
      await sendRejectionEmail(booking, salon, customer);
    } catch (error) {
      return res.status(502).json({ success: false, message: 'The email could not be sent. Check the email settings and try again.' });
    }
    return res.json({ success: true, message: 'Rejection email sent to the customer.' });
  } catch (error) {
    return next(error);
  }
};

const getRejectionFeedbackDetails = async (req, res, next) => {
  try {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!/^[a-f0-9]{64}$/.test(token)) {
      return res.status(400).json({ success: false, message: 'This feedback link is invalid or expired.' });
    }
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const booking = await Booking.findOne({
      rejectionFeedbackTokenHash: tokenHash,
      rejectionFeedbackExpiresAt: { $gt: new Date() },
      status: 'rejected',
    }).select('salonSnapshot rejectionReason rejectionFeedbackSubmittedAt');
    if (!booking) return res.status(404).json({ success: false, message: 'This feedback link is invalid or expired.' });
    if (booking.rejectionFeedbackSubmittedAt) {
      return res.status(409).json({ success: false, message: 'Feedback has already been submitted for this booking.' });
    }
    return res.json({
      success: true,
      salonName: booking.salonSnapshot?.name || 'the salon',
      rejectionReason: booking.rejectionReason,
      options: feedbackOptions,
    });
  } catch (error) {
    return next(error);
  }
};

const submitRejectionFeedback = async (req, res, next) => {
  try {
    const { token, feedback, customFeedback = '' } = req.body;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
      return res.status(400).json({ success: false, message: 'This feedback link is invalid or expired.' });
    }
    if (!feedbackOptions.includes(feedback)) {
      return res.status(400).json({ success: false, message: 'Choose one of the feedback options.' });
    }
    if (typeof customFeedback !== 'string' || customFeedback.trim().length > 500) {
      return res.status(400).json({ success: false, message: 'Feedback must be 500 characters or fewer.' });
    }
    const details = customFeedback.trim();
    if (feedback === 'Other' && !details) {
      return res.status(400).json({ success: false, message: 'Please enter your feedback.' });
    }
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const savedFeedback = feedback === 'Other' ? details : feedback + (details ? `: ${details}` : '');
    const booking = await Booking.findOneAndUpdate(
      {
        rejectionFeedbackTokenHash: tokenHash,
        rejectionFeedbackExpiresAt: { $gt: new Date() },
        status: 'rejected',
        rejectionFeedbackSubmittedAt: { $exists: false },
      },
      {
        $set: { rejectionFeedback: savedFeedback, rejectionFeedbackSubmittedAt: new Date() },
        $unset: { rejectionFeedbackTokenHash: 1, rejectionFeedbackExpiresAt: 1 },
      },
      { new: true }
    );
    if (!booking) return res.status(409).json({ success: false, message: 'This feedback link is invalid, expired, or already used.' });
    return res.json({ success: true, message: 'Thank you. Your feedback has been saved.' });
  } catch (error) {
    return next(error);
  }
};

const cancelMyBooking = async (req, res, next) => {
  try {
    const booking = await Booking.findOne({
      _id: req.params.id,
      userId: req.user.id,
      status: { $in: ['pending_payment', 'waiting'] },
    });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found or can no longer be cancelled.' });
    if (booking.paymentMethod === 'upi_manual' && booking.upiReference && booking.paymentStatus === 'pending') {
      return res.status(409).json({
        success: false,
        message: 'A UPI reference is awaiting review. Contact support or wait for the administrator to verify it before cancelling.',
      });
    }
    if (booking.status === 'waiting' && booking.paymentStatus === 'paid' && booking.paymentMode === 'full') {
      return res.status(409).json({
        success: false,
        message: 'Full-payment cancellation requires a refund through salon support. Your booking is unchanged.',
      });
    }

    const cancelled = await Booking.findOneAndUpdate(
      { _id: booking._id, userId: req.user.id, status: booking.status },
      { $set: { status: 'cancelled', cancelledAt: new Date() } },
      { new: true, runValidators: true }
    );
    if (!cancelled) return res.status(409).json({ success: false, message: 'Booking status changed. Refresh and try again.' });
    const creditToRestore = booking.paymentStatus === 'paid' ? 0 : cancelled.walletCreditUsed;
    await releaseBookingSlot(req.user.id, creditToRestore);
    const queue = await refreshWaitEstimates(booking.salonId);
    return res.json({
      success: true,
      message: booking.paymentStatus !== 'paid'
        ? 'Pending payment cancelled and reserved credits returned.'
        : 'Booking cancelled. The advance payment is non-refundable.',
      walletCreditAdded: 0,
      walletCreditReturned: creditToRestore,
      queue,
    });
  } catch (error) {
    return next(error);
  }
};

const expirePendingPayments = async () => {
  const expired = await Booking.find({
    status: 'pending_payment',
    paymentExpiresAt: { $lte: new Date() },
  }).select('_id userId walletCreditUsed');
  if (!expired.length) return;
  await Promise.all(expired.map(async (booking) => {
    const result = await Booking.updateOne(
      { _id: booking._id, status: 'pending_payment', paymentExpiresAt: { $lte: new Date() } },
      { $set: { status: 'cancelled', paymentStatus: 'failed', cancelledAt: new Date() } }
    );
    if (result.modifiedCount === 1) {
      await releaseBookingSlot(booking.userId, booking.walletCreditUsed || 0);
    }
  }));
};

module.exports = {
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
  expirePendingPayments,
};
