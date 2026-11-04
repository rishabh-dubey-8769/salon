const crypto = require('crypto');
const Razorpay = require('razorpay');

const getClient = () => {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = process.env;
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    const error = new Error('Online payments are not configured. Set Razorpay keys before accepting bookings.');
    error.status = 503;
    throw error;
  }
  return new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
};

const createOrder = (options) => getClient().orders.create(options);
const fetchPayment = (paymentId) => getClient().payments.fetch(paymentId);

const verifyCheckoutSignature = (orderId, paymentId, signature) => {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret || !orderId || !paymentId || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest();
  let actual;
  try {
    actual = Buffer.from(signature, 'hex');
  } catch (_error) {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

module.exports = { createOrder, fetchPayment, verifyCheckoutSignature };
