require('dotenv').config();

const app = require('./app');
const { connectDB } = require('./config/db');
const { expirePendingPayments } = require('./controllers/bookingController');
const ensureAdmin = require('./utils/ensureAdmin');

const start = async () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be set to a random value of at least 32 characters.');
  }
  if (!process.env.OTP_SECRET || process.env.OTP_SECRET.length < 32) {
    throw new Error('OTP_SECRET must be set to a random value of at least 32 characters.');
  }

  await connectDB();
  await ensureAdmin();
  const port = Number(process.env.PORT) || 5000;
  const paymentCleanup = setInterval(() => {
    expirePendingPayments().catch((error) => console.error('Payment cleanup failed:', error.message));
  }, 60_000);
  paymentCleanup.unref();
  app.listen(port, () => {
    console.log(`Salon booking API listening on port ${port}`);
  });
};

start().catch((error) => {
  console.error('Unable to start the API:', error.message);
  process.exitCode = 1;
});
