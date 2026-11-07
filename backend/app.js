require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const authRoutes = require('./routes/authRoutes');
const salonRoutes = require('./routes/salonRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const adminRoutes = require('./routes/adminRoutes');
const contactRoutes = require('./routes/contactRoutes');
const announcementRoutes = require('./routes/announcementRoutes');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { getTrustProxySetting } = require('./utils/trustProxy');

const app = express();
const trustProxySetting = getTrustProxySetting();
if (trustProxySetting !== false) app.set('trust proxy', trustProxySetting);
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim());

app.disable('x-powered-by');
app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Origin is not allowed by CORS'));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  const mutatingMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if (!mutatingMethod || !req.cookies.token) return next();
  const origin = req.get('origin');
  if (!origin || !allowedOrigins.includes(origin)) {
    return res.status(403).json({ success: false, message: 'Request origin could not be verified.' });
  }
  return next();
});
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
}));

app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/salons', salonRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/announcements', announcementRoutes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
