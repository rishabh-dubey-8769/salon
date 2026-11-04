const express = require('express');
const {
  getSalons,
  getSalonById,
  createSalon,
  updateMySalon,
  getMySalons,
  getMySalonRatings,
  rateSalon,
  setOpenStatus,
  setCustomerBlock,
} = require('../controllers/salonController');
const { protect, requireRole } = require('../middleware/authMiddleware');
const { messageSalonOwner } = require('../controllers/messageController');
const rateLimit = require('express-rate-limit');

const router = express.Router();
const messageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
const ratingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

router.get('/', getSalons);
router.get('/mine', protect, requireRole('owner'), getMySalons);
router.get('/my-ratings', protect, requireRole('user'), getMySalonRatings);
router.post('/', protect, requireRole('owner'), createSalon);
router.patch('/mine/:id', protect, requireRole('owner'), updateMySalon);
router.patch('/mine/:id/open', protect, requireRole('owner'), setOpenStatus);
router.patch('/mine/:id/customers/:customerId/block', protect, requireRole('owner'), setCustomerBlock);
router.post('/:id/rating', protect, requireRole('user'), ratingLimiter, rateSalon);
router.post('/:id/message', protect, messageLimiter, messageSalonOwner);
router.get('/:id', getSalonById);

module.exports = router;
