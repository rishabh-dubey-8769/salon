const mongoose = require('mongoose');
const Booking = require('../models/booking');
const Salon = require('../models/salon');
const sendMessageEmail = require('../utils/sendMessageEmail');

const validateMessage = (value) => (
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 2000
);

const getSender = (user) => ({
  name: user.name,
  email: user.email,
  role: user.role,
});

const messageSalonOwner = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid salon.' });
    }
    if (!validateMessage(req.body.message)) {
      return res.status(400).json({ success: false, message: 'Write a message of 1 to 2000 characters.' });
    }

    const salon = await Salon.findOne({
      _id: req.params.id,
      isApproved: true,
      isActive: true,
    }).populate('ownerId', 'name email');
    if (!salon) return res.status(404).json({ success: false, message: 'Salon not found.' });
    if (salon.ownerId?._id.equals(req.user._id)) {
      return res.status(400).json({ success: false, message: 'You cannot message yourself as the salon owner.' });
    }
    if (!salon.ownerId?.email) {
      return res.status(409).json({ success: false, message: 'This salon does not have a registered owner email for messages.' });
    }

    await sendMessageEmail({
      to: salon.ownerId.email,
      sender: getSender(req.user),
      message: req.body.message.trim(),
      context: salon.name,
    });
    return res.json({ success: true, message: 'Your message was sent to the salon owner.' });
  } catch (error) {
    return next(error);
  }
};

const messageBookingCustomer = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid booking.' });
    }
    if (!validateMessage(req.body.message)) {
      return res.status(400).json({ success: false, message: 'Write a message of 1 to 2000 characters.' });
    }

    const booking = await Booking.findById(req.params.id)
      .populate('userId', 'name email role')
      .populate('salonId', 'name ownerId');
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found.' });

    const isOwningSalon = req.user.role === 'owner' &&
      booking.salonId?.ownerId?.equals(req.user._id);
    if (!isOwningSalon && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'You cannot message this booking customer.' });
    }
    if (!booking.userId?.email) {
      return res.status(409).json({ success: false, message: 'This customer does not have a registered email for messages.' });
    }

    await sendMessageEmail({
      to: booking.userId.email,
      sender: getSender(req.user),
      message: req.body.message.trim(),
      context: booking.salonId?.name || 'your salon booking',
    });
    return res.json({ success: true, message: 'Your message was sent to the customer.' });
  } catch (error) {
    return next(error);
  }
};

module.exports = { messageSalonOwner, messageBookingCustomer };
