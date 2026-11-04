const express = require('express');
const rateLimit = require('express-rate-limit');
const { sendOTP, verifyOTP, registerUser, loginUser, resetPassword, me, updateProfile, logout } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many verification attempts. Try again later.' },
});

router.post('/send-otp', otpLimiter, sendOTP);
router.post('/verify-otp', otpLimiter, verifyOTP);
router.post('/register', otpLimiter, registerUser);
router.post('/login', loginUser);
router.post('/reset-password', otpLimiter, resetPassword);
router.post('/logout', logout);
router.get('/me', protect, me);
router.patch('/profile', protect, updateProfile);

module.exports = router;
