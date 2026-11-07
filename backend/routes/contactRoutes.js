const express = require('express');
const rateLimit = require('express-rate-limit');
const { sendAdminContactMessage } = require('../controllers/contactController');
const { protect, requireRole } = require('../middleware/authMiddleware');

const router = express.Router();
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

router.post('/', protect, requireRole('user', 'owner'), contactLimiter, sendAdminContactMessage);

module.exports = router;
