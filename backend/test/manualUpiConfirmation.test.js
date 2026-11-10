const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Booking = require('../models/booking');
const { queueForSalon } = require('../utils/queue');
const {
  confirmManagedBookingPayment,
} = require('../controllers/adminController');
const { submitUpiReference } = require('../controllers/bookingController');

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test('admin can confirm a pending UPI booking without a submitted reference', async () => {
  const originals = {
    findOneAndUpdate: Booking.findOneAndUpdate,
    find: Booking.find,
    updateOne: Booking.updateOne,
  };
  const salonId = new mongoose.Types.ObjectId();
  const booking = {
    _id: new mongoose.Types.ObjectId(),
    salonId,
    status: 'waiting',
    priority: 'standard',
    queueSequence: 1,
    appointmentDate: new Date().toISOString().slice(0, 10),
    appointmentTimeZone: 'UTC',
    services: [],
  };
  let capturedFilter;
  let capturedUpdate;
  let capturedQueueFilter;
  let queueWaitUpdate;
  Booking.findOneAndUpdate = async (filter, update) => {
    capturedFilter = filter;
    capturedUpdate = update;
    return booking;
  };
  Booking.find = (filter) => {
    capturedQueueFilter = filter;
    return {
      populate() { return this; },
      lean: async () => [booking],
    };
  };
  Booking.updateOne = async (filter, update) => {
    queueWaitUpdate = { filter, update };
    return { acknowledged: true };
  };

  try {
    const response = createResponse();
    let forwardedError;
    await confirmManagedBookingPayment({
      params: { id: booking._id.toString() },
      user: { _id: new mongoose.Types.ObjectId() },
    }, response, (error) => { forwardedError = error; });

    assert.equal(forwardedError, undefined);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
    assert.equal(capturedFilter.paymentMethod, 'upi_manual');
    assert.equal(capturedFilter.paymentStatus, 'pending');
    assert.equal(capturedFilter.status, 'pending_payment');
    assert.equal(Object.hasOwn(capturedFilter, 'upiReference'), false);
    assert.equal(capturedUpdate.$set.paymentStatus, 'paid');
    assert.equal(capturedUpdate.$set.status, 'waiting');
    assert.deepEqual(capturedQueueFilter.status.$in, ['waiting', 'in_service']);
    assert.equal(queueWaitUpdate.filter._id, booking._id.toString());
    assert.equal(queueWaitUpdate.update.$set.estimatedWaitMinutes, 0);
  } finally {
    Booking.findOneAndUpdate = originals.findOneAndUpdate;
    Booking.find = originals.find;
    Booking.updateOne = originals.updateOne;
  }
});

test('confirmed same-day UPI bookings without references appear in the live owner queue', async () => {
  const originalFind = Booking.find;
  const today = new Date();
  const appointmentDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(today);
  const booking = {
    _id: new mongoose.Types.ObjectId(),
    salonId: new mongoose.Types.ObjectId(),
    userId: { _id: new mongoose.Types.ObjectId(), name: 'Customer' },
    status: 'waiting',
    paymentStatus: 'paid',
    paymentMethod: 'upi_manual',
    appointmentDate,
    appointmentTimeZone: 'UTC',
    priority: 'standard',
    queueSequence: 4,
    services: [{ durationMinutes: 30 }],
  };
  let capturedFilter;
  Booking.find = (filter) => {
    capturedFilter = filter;
    return {
      populate() { return this; },
      lean: async () => [booking],
    };
  };

  try {
    const queue = await queueForSalon(booking.salonId);
    assert.deepEqual(capturedFilter.status.$in, ['waiting', 'in_service']);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].id, booking._id.toString());
    assert.equal(queue[0].queuePosition, 1);
    assert.equal(Object.hasOwn(queue[0], 'upiReference'), false);
  } finally {
    Booking.find = originalFind;
  }
});

test('customer may add a UPI reference after an admin has confirmed payment', async () => {
  const originalFindOneAndUpdate = Booking.findOneAndUpdate;
  let capturedFilter;
  Booking.findOneAndUpdate = async (filter) => {
    capturedFilter = filter;
    return { _id: filter._id, upiReference: '123456789012' };
  };

  try {
    const response = createResponse();
    let forwardedError;
    await submitUpiReference({
      params: { id: '0123456789abcdef01234567' },
      user: { id: 'customer-id' },
      body: { upiReference: '123456789012' },
    }, response, (error) => { forwardedError = error; });

    assert.equal(forwardedError, undefined);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.booking.upiReference, '123456789012');
    assert.equal(capturedFilter.paymentMethod, 'upi_manual');
    assert.equal(capturedFilter.upiReference.$exists, false);
    assert.ok(capturedFilter.$or.some((condition) =>
      condition.paymentStatus === 'pending' && condition.status === 'pending_payment'
    ));
    assert.ok(capturedFilter.$or.some((condition) =>
      condition.paymentStatus === 'paid' &&
      condition.status.$in.includes('waiting') &&
      condition.paymentVerifiedAt.$exists === true
    ));
  } finally {
    Booking.findOneAndUpdate = originalFindOneAndUpdate;
  }
});
