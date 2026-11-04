const test = require('node:test');
const assert = require('node:assert/strict');
const { sortQueue } = require('../utils/queue');
const distanceKm = require('../utils/distance');
const { asCsv, getPeriodBounds } = require('../utils/report');
const normalizeContactPhone = require('../utils/contactPhone');
const { hashPassword, verifyPassword } = require('../utils/password');
const {
  formatDateInTimeZone,
  isAppointmentDateAvailable,
  isAppointmentDateDue,
  isValidAppointmentDate,
  isValidTimeZone,
  localDateTimeToUtc,
} = require('../utils/appointmentDate');
const { containsSearchText } = require('../utils/searchText');
const { generateAccountUid } = require('../utils/accountUid');
const User = require('../models/user');
const Booking = require('../models/booking');
const Salon = require('../models/salon');
const { createUpiPaymentDetails, getUpiAdvanceAmount } = require('../utils/upiPayment');
const {
  getBookingHistory,
  submitRejectionFeedback,
  updateQueueBooking,
} = require('../controllers/bookingController');

test('standard bookings remain FIFO and express bookings lead only the waiting queue', () => {
  const queue = [
    { status: 'waiting', priority: 'standard', queueSequence: 1 },
    { status: 'in_service', priority: 'standard', queueSequence: 2 },
    { status: 'waiting', priority: 'express', queueSequence: 3 },
    { status: 'waiting', priority: 'standard', queueSequence: 4 },
  ];

  assert.deepEqual(
    sortQueue(queue).map((booking) => booking.queueSequence),
    [2, 3, 1, 4]
  );
});

test('appointment dates validate calendar days and respect the selected timezone', () => {
  assert.equal(isValidAppointmentDate('2028-02-29'), true);
  assert.equal(isValidAppointmentDate('2027-02-29'), false);
  assert.equal(isValidAppointmentDate('2027-2-03'), false);
  assert.equal(isValidTimeZone('Asia/Kolkata'), true);
  assert.equal(isValidTimeZone('Not/A_Timezone'), false);
  assert.equal(formatDateInTimeZone(new Date('2027-01-01T12:00:00.000Z'), 'Pacific/Auckland'), '2027-01-02');
  assert.equal(isAppointmentDateAvailable('2027-01-02', 'Pacific/Auckland', new Date('2027-01-01T12:00:00.000Z')), true);
  assert.equal(isAppointmentDateAvailable('2027-01-01', 'Pacific/Auckland', new Date('2027-01-01T12:00:00.000Z')), false);
  assert.equal(isAppointmentDateDue('2027-01-03', 'Pacific/Auckland', new Date('2027-01-01T12:00:00.000Z')), false);
  assert.equal(isAppointmentDateDue('2027-01-02', 'Pacific/Auckland', new Date('2027-01-01T12:00:00.000Z')), true);
});

test('history filter date boundaries convert local midnight to UTC', () => {
  assert.equal(
    localDateTimeToUtc('2026-11-05', '00:00', 'Asia/Kolkata').toISOString(),
    '2026-11-04T18:30:00.000Z'
  );
});

test('booking history applies customer ownership and selected status filters', async () => {
  const originalFind = Booking.find;
  const originalCountDocuments = Booking.countDocuments;
  let capturedQuery;
  const emptyQuery = {
    populate() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    lean: async () => [],
  };
  Booking.find = (query) => {
    capturedQuery = query;
    return emptyQuery;
  };
  Booking.countDocuments = async () => 0;
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    await getBookingHistory({
      user: { _id: 'customer-id', role: 'user', uid: 'C123' },
      query: { status: 'pending_payment' },
    }, response, (error) => { throw error; });
    assert.equal(response.statusCode, 200);
    assert.equal(capturedQuery.userId, 'customer-id');
    assert.equal(capturedQuery.status, 'pending_payment');
    assert.deepEqual(response.body.bookings, []);
  } finally {
    Booking.find = originalFind;
    Booking.countDocuments = originalCountDocuments;
  }
});

test('rejected bookings retain a reason and salon blocks are private to the database', () => {
  assert.ok(Booking.schema.path('status').enumValues.includes('rejected'));
  assert.equal(Salon.schema.path('blockedCustomerIds').options.select, false);
  assert.ok(Booking.schema.path('rejectionReason'));
  assert.ok(Booking.schema.path('rejectionFeedback'));
});

test('rejection feedback is saved once against the hashed email token', async () => {
  const crypto = require('node:crypto');
  const originalFindOneAndUpdate = Booking.findOneAndUpdate;
  const token = 'a'.repeat(64);
  let capturedFilter;
  let capturedUpdate;
  Booking.findOneAndUpdate = async (filter, update) => {
    capturedFilter = filter;
    capturedUpdate = update;
    return { _id: 'booking-id' };
  };
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    await submitRejectionFeedback({
      body: { token, feedback: 'I could not arrive on time' },
    }, response, (error) => { throw error; });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
    assert.equal(
      capturedFilter.rejectionFeedbackTokenHash,
      crypto.createHash('sha256').update(token).digest('hex')
    );
    assert.deepEqual(capturedFilter.rejectionFeedbackSubmittedAt, { $exists: false });
    assert.equal(capturedUpdate.$set.rejectionFeedback, 'I could not arrive on time');
    assert.ok(capturedUpdate.$unset.rejectionFeedbackTokenHash);
  } finally {
    Booking.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test('salon owners can reject a waiting booking with a saved reason without changing payment fields', async () => {
  const originalBookingFindById = Booking.findById;
  const originalBookingFindOneAndUpdate = Booking.findOneAndUpdate;
  const originalBookingFind = Booking.find;
  const originalSalonFindOne = Salon.findOne;
  const originalUserFindById = User.findById;
  const originalUserUpdateOne = User.updateOne;
  const bookingId = '507f1f77bcf86cd799439011';
  let bookingUpdate;
  let slotUpdate;
  Booking.findById = async () => ({
    _id: bookingId,
    id: bookingId,
    salonId: 'salon-id',
    userId: 'customer-id',
    status: 'waiting',
    walletCreditUsed: 2,
    paymentAmount: 1,
    paymentStatus: 'paid',
  });
  Booking.findOneAndUpdate = async (_filter, update) => {
    bookingUpdate = update;
    return {
      _id: bookingId,
      id: bookingId,
      status: 'rejected',
      rejectionReason: update.$set.rejectionReason,
    };
  };
  Booking.find = () => ({
    populate() { return this; },
    lean: async () => [],
  });
  Salon.findOne = async () => ({ _id: 'salon-id', name: 'Test Salon' });
  User.findById = () => ({ select: async () => null });
  User.updateOne = async (filter, update) => {
    slotUpdate = { filter, update };
  };
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    await updateQueueBooking({
      params: { id: bookingId },
      body: { status: 'rejected', rejectionReasonCode: 'no_show', rejectionDetails: 'No arrival after the wait period.' },
      user: { id: 'owner-id' },
    }, response, (error) => { throw error; });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.booking.status, 'rejected');
    assert.equal(response.body.booking.rejectionReason, 'Customer did not arrive: No arrival after the wait period.');
    assert.equal(bookingUpdate.$set.status, 'rejected');
    assert.equal(bookingUpdate.$set.paymentStatus, undefined);
    assert.equal(slotUpdate.update.$inc.activeBookingCount, -1);
    assert.equal(slotUpdate.update.$inc.walletCredits, 2);
    assert.equal(response.body.emailSent, false);
  } finally {
    Booking.findById = originalBookingFindById;
    Booking.findOneAndUpdate = originalBookingFindOneAndUpdate;
    Booking.find = originalBookingFind;
    Salon.findOne = originalSalonFindOne;
    User.findById = originalUserFindById;
    User.updateOne = originalUserUpdateOne;
  }
});

test('owner booking history applies salon ownership and selected status filters', async () => {
  const originalBookingFind = Booking.find;
  const originalCountDocuments = Booking.countDocuments;
  const originalSalonFind = require('../models/salon').find;
  let capturedQuery;
  const emptyQuery = {
    populate() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    lean: async () => [],
  };
  Booking.find = (query) => {
    capturedQuery = query;
    return emptyQuery;
  };
  Booking.countDocuments = async () => 0;
  require('../models/salon').find = () => ({
    select() { return this; },
    lean: async () => [{ _id: 'salon-id' }],
  });
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    await getBookingHistory({
      user: { _id: 'owner-id', role: 'owner', uid: 'S123' },
      query: { status: 'cancelled' },
    }, response, (error) => { throw error; });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(capturedQuery.salonId, { $in: ['salon-id'] });
    assert.equal(capturedQuery.status, 'cancelled');
  } finally {
    Booking.find = originalBookingFind;
    Booking.countDocuments = originalCountDocuments;
    require('../models/salon').find = originalSalonFind;
  }
});

test('admin search matches partial text without case sensitivity', () => {
  assert.equal(containsSearchText('SUDHANSHU SHEKHAR', 'sudhan'), true);
  assert.equal(containsSearchText('sudhanshu.shekhar192005@gmail.com', 'SHEKHAR192'), true);
  assert.equal(containsSearchText('Amit Saloon', 'MIT SAL'), true);
  assert.equal(containsSearchText('Amit Saloon', 'not present'), false);
});

test('account UIDs have role prefixes, numeric suffixes, and a database uniqueness constraint', () => {
  const customerUids = Array.from({ length: 100 }, () => generateAccountUid('user'));
  const ownerUids = Array.from({ length: 100 }, () => generateAccountUid('owner'));
  assert.ok(customerUids.every((uid) => /^C\d{24}$/.test(uid)));
  assert.ok(ownerUids.every((uid) => /^S\d{24}$/.test(uid)));
  assert.equal(new Set([...customerUids, ...ownerUids]).size, 200);
  const validUidUser = new User({ name: 'Test User', role: 'user', uid: 'C123456789012345678901234' });
  const invalidUidUser = new User({ name: 'Test User', role: 'user', uid: 'X123456789012345678901234' });
  assert.equal(validUidUser.validateSync()?.errors.uid, undefined);
  assert.ok(invalidUidUser.validateSync()?.errors.uid);
  assert.ok(User.schema.indexes().some(([fields, options]) =>
    fields.uid === 1 && options.unique && options.sparse
  ));
});

test('account UIDs are omitted from ordinary serialized user responses', () => {
  const user = new User({ name: 'Test User', role: 'user', uid: 'C123456789012345678901234' });
  const serialized = user.toJSON();
  assert.equal(Object.hasOwn(serialized, 'uid'), false);
});

test('weekly report bounds begin Monday and include the selected week through today', () => {
  const { start, end } = getPeriodBounds(
    { period: 'week' },
    new Date('2026-11-04T13:15:42.433Z')
  );
  assert.equal(start.toISOString(), '2026-11-02T00:00:00.000Z');
  assert.equal(end.toISOString(), '2026-11-04T23:59:59.999Z');
});

test('salon income reports exclude rejected bookings', async () => {
  const { buildReport } = require('../utils/report');
  const originalBookingFind = Booking.find;
  let capturedQuery;
  Booking.find = (query) => {
    capturedQuery = query;
    return {
      populate() { return this; },
      sort() { return this; },
      limit() { return this; },
      lean: async () => [],
    };
  };
  try {
    await buildReport({ query: { period: 'day' }, now: new Date('2026-11-05T00:00:00.000Z') });
    assert.deepEqual(capturedQuery.status, { $nin: ['cancelled', 'rejected'] });
  } finally {
    Booking.find = originalBookingFind;
  }
});

test('distance returns zero for the same coordinates and a plausible city distance', () => {
  assert.equal(distanceKm(25.5941, 85.1376, 25.5941, 85.1376), 0);
  const patnaToDelhi = distanceKm(25.5941, 85.1376, 28.6139, 77.209);
  assert.ok(patnaToDelhi > 850 && patnaToDelhi < 900);
});

test('CSV export neutralizes spreadsheet formulas from user-controlled fields', () => {
  const csv = asCsv({
    bookings: [{
      id: 'b1',
      salon: '=HYPERLINK("https://example.com")',
      customer: 'Customer',
      services: 'Hair Cut',
      total: 100,
      paymentAmount: 1,
      paymentMode: 'token',
      priority: 'standard',
      status: 'waiting',
      createdAt: new Date(0).toISOString(),
    }],
  });
  assert.match(csv, /"'=HYPERLINK/);
});

test('UPI booking advances are fixed at ₹1 standard and ₹25 express', () => {
  assert.equal(getUpiAdvanceAmount('standard'), 1);
  assert.equal(getUpiAdvanceAmount('express'), 25);
  assert.throws(() => getUpiAdvanceAmount('invalid'), /Invalid booking priority/);
});

test('UPI intent fixes payee, exact amount, currency, and booking reference', () => {
  const payment = createUpiPaymentDetails({
    bookingId: '0123456789abcdef01234567',
    amount: getUpiAdvanceAmount('standard'),
    payeeAddress: 'admin@okbank',
    payeeName: 'Salon Admin',
  });
  const params = new URL(payment.upiUrl).searchParams;
  assert.equal(payment.amount, 1);
  assert.equal(params.get('pa'), 'admin@okbank');
  assert.equal(params.get('pn'), 'Salon Admin');
  assert.equal(params.get('am'), '1.00');
  assert.equal(params.get('cu'), 'INR');
  assert.equal(params.get('tr'), 'SF0123456789abcdef01234567');
});

test('booking UPI reference is globally unique', () => {
  assert.ok(Booking.schema.indexes().some(([fields, options]) =>
    fields.upiReference === 1 && options.unique && options.sparse
  ));
});

test('contact phone accepts unverified international and local numbers in normalized form', () => {
  assert.equal(normalizeContactPhone('+91 98765-43210'), '+919876543210');
  assert.equal(normalizeContactPhone('9876543210'), '9876543210');
  assert.equal(normalizeContactPhone('not a phone'), null);
});

test('password hashing accepts arbitrary characters and lengths beyond bcrypt limits', async () => {
  const password = '漢🙂 !'.repeat(30);
  const passwordHash = await hashPassword(password);

  assert.equal((await verifyPassword(password, passwordHash)).matches, true);
  assert.equal((await verifyPassword('different', passwordHash)).matches, false);
});
