const User = require('../models/user');
const { generateToken, cookieOptions } = require('../utils/generateToken');
const { issueOtp, verifyOtp, consumeVerifiedOtp } = require('../utils/otp');
const normalizeContactPhone = require('../utils/contactPhone');
const { hashPassword, verifyPassword } = require('../utils/password');
const { createAccount } = require('../utils/accountUid');
const validPassword = (value) =>
  typeof value === 'string' && value.length > 0;

const normalizeContact = ({ email, phone }) => {
  if (email && phone) return null;
  if (email) {
    const normalizedEmail = String(email).trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ? normalizedEmail : null;
  }
  if (phone) {
    const normalizedPhone = String(phone).replace(/[\s()-]/g, '');
    return /^\+[1-9]\d{7,14}$/.test(normalizedPhone) ? normalizedPhone : null;
  }
  return null;
};

const issueSession = (res, user) => {
  res.cookie('token', generateToken(user.id), cookieOptions());
};

const sendOTP = async (req, res, next) => {
  try {
    const contact = normalizeContact(req.body);
    const purpose = req.body.purpose || 'register';
    if (!contact || !['register', 'reset_password'].includes(purpose)) {
      return res.status(400).json({ success: false, message: 'Enter one valid email address or E.164 phone number.' });
    }

    const user = contact.includes('@')
      ? await User.findOne({ email: contact })
      : await User.findOne({ phone: contact });
    if (purpose === 'register' && user) {
      return res.status(409).json({
        success: false,
        message: 'An account already exists for this contact. Sign in or use Forgot password.',
      });
    }
    if (purpose === 'reset_password' && !user) {
      return res.status(200).json({ success: true, message: 'If the contact is eligible, a verification code will be sent.' });
    }

    await issueOtp(contact, purpose);
    return res.json({ success: true, message: 'Verification code sent. It expires in 5 minutes.' });
  } catch (error) {
    return next(error);
  }
};

const verifyOTP = async (req, res, next) => {
  try {
    const contact = normalizeContact(req.body);
    const purpose = req.body.purpose;
    const code = String(req.body.otp || '');
    if (!contact || !['register', 'reset_password'].includes(purpose) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, message: 'Enter a valid contact, purpose, and 6-digit verification code.' });
    }

    const user = contact.includes('@')
      ? await User.findOne({ email: contact })
      : await User.findOne({ phone: contact });
    if ((purpose === 'register' && user) || (purpose === 'reset_password' && !user)) {
      return res.status(400).json({ success: false, message: 'Verification code is invalid or expired.' });
    }

    const verificationToken = await verifyOtp(contact, purpose, code);
    if (!verificationToken) {
      return res.status(400).json({ success: false, message: 'Verification code is invalid or expired.' });
    }
    return res.json({ success: true, message: 'Contact verified.', verificationToken });
  } catch (error) {
    return next(error);
  }
};

const registerUser = async (req, res, next) => {
  try {
    const { name, password } = req.body;
    const contact = normalizeContact(req.body);
    if (!contact || !String(name || '').trim()) {
      return res.status(400).json({ success: false, message: 'Name and a valid contact are required.' });
    }
    if (!validPassword(password)) {
      return res.status(400).json({ success: false, message: 'Enter a password.' });
    }
    const field = contact.includes('@') ? 'email' : 'phone';
    if (await User.exists({ [field]: contact })) {
      return res.status(409).json({ success: false, message: 'An account already exists for this contact.' });
    }
    if (!(await consumeVerifiedOtp(contact, 'register', req.body.verificationToken))) {
      return res.status(400).json({ success: false, message: 'Verify your contact before creating the account.' });
    }

    const user = await createAccount({
      name: String(name).trim(),
      [field]: contact,
      passwordHash: await hashPassword(password),
      role: req.body.accountType === 'owner' ? 'owner' : 'user',
    });
    issueSession(res, user);
    return res.status(201).json({ success: true, message: 'Account created.', user });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'An account already exists for this contact.' });
    }
    return next(error);
  }
};

const loginUser = async (req, res, next) => {
  try {
    const contact = normalizeContact(req.body);
    const { password } = req.body;
    if (!contact || !validPassword(password)) {
      return res.status(400).json({ success: false, message: 'Enter a valid email or phone and password.' });
    }
    const field = contact.includes('@') ? 'email' : 'phone';
    const user = await User.findOne({ [field]: contact }).select('+passwordHash');
    const verification = user && await verifyPassword(password, user.passwordHash);
    if (!verification?.matches || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Invalid contact or password.' });
    }
    if (verification.needsRehash) {
      user.passwordHash = await hashPassword(password);
      await user.save();
    }
    issueSession(res, user);
    return res.json({ success: true, user });
  } catch (error) {
    return next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const contact = normalizeContact(req.body);
    const { password, verificationToken } = req.body;
    if (!contact || !validPassword(password)) {
      return res.status(400).json({ success: false, message: 'Provide a valid contact and password.' });
    }
    if (!(await consumeVerifiedOtp(contact, 'reset_password', verificationToken))) {
      return res.status(400).json({ success: false, message: 'Verify your contact before resetting the password.' });
    }
    const field = contact.includes('@') ? 'email' : 'phone';
    const user = await User.findOneAndUpdate(
      { [field]: contact, isActive: true },
      { passwordHash: await hashPassword(password) },
      { new: true, runValidators: true }
    );
    if (!user) return res.status(400).json({ success: false, message: 'Unable to reset password for this account.' });
    issueSession(res, user);
    return res.json({ success: true, message: 'Password updated.', user });
  } catch (error) {
    return next(error);
  }
};

const me = (req, res) => res.json({ success: true, user: req.user });

const updateProfile = async (req, res, next) => {
  try {
    const updates = {};
    const removals = {};
    const contactPhone = normalizeContactPhone(req.body.contactPhone);
    if (!contactPhone) {
      return res.status(400).json({
        success: false,
        message: 'A valid mobile number is required. Include the country code if needed; verification is not required.',
      });
    }
    updates.contactPhone = contactPhone;

    if (Object.hasOwn(req.body, 'name')) {
      const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      if (!name || name.length > 80) {
        return res.status(400).json({ success: false, message: 'Name must be between 1 and 80 characters.' });
      }
      updates.name = name;
    }

    if (Object.hasOwn(req.body, 'gender')) {
      const gender = typeof req.body.gender === 'string' ? req.body.gender.trim() : '';
      if (gender.length > 30) {
        return res.status(400).json({ success: false, message: 'Gender must be 30 characters or fewer.' });
      }
      updates.gender = gender;
    }

    if (Object.hasOwn(req.body, 'dateOfBirth')) {
      if (req.body.dateOfBirth === '') {
        removals.dateOfBirth = 1;
      } else {
        const dateOfBirth = new Date(req.body.dateOfBirth);
        const earliestDate = new Date();
        earliestDate.setFullYear(earliestDate.getFullYear() - 120);
        if (
          Number.isNaN(dateOfBirth.getTime()) ||
          dateOfBirth > new Date() ||
          dateOfBirth < earliestDate
        ) {
          return res.status(400).json({ success: false, message: 'Enter a valid date of birth.' });
        }
        updates.dateOfBirth = dateOfBirth;
      }
    }

    if (Object.hasOwn(req.body, 'location')) {
      const location = req.body.location;
      if (location === null) {
        removals.location = 1;
      } else if (!location || typeof location !== 'object' || Array.isArray(location)) {
        return res.status(400).json({ success: false, message: 'Enter a valid location.' });
      } else {
        const label = typeof location.label === 'string' ? location.label.trim() : '';
        const hasLat = location.lat !== '' && location.lat !== undefined && location.lat !== null;
        const hasLng = location.lng !== '' && location.lng !== undefined && location.lng !== null;
        const pinCode = location.pinCode === undefined ? '' : location.pinCode;
        if (label.length > 160 || hasLat !== hasLng || typeof pinCode !== 'string' || pinCode.trim().length > 20) {
          return res.status(400).json({ success: false, message: 'Enter a location label and both coordinates, or leave coordinates blank.' });
        }
        const coordinates = hasLat ? { lat: Number(location.lat), lng: Number(location.lng) } : {};
        if (
          hasLat &&
          (!Number.isFinite(coordinates.lat) || coordinates.lat < -90 || coordinates.lat > 90 ||
            !Number.isFinite(coordinates.lng) || coordinates.lng < -180 || coordinates.lng > 180)
        ) {
          return res.status(400).json({ success: false, message: 'Location coordinates are invalid.' });
        }
        updates.location = { label, ...coordinates, pinCode: pinCode.trim() };
      }
    }

    if (Object.hasOwn(req.body, 'profileImage')) {
      const { profileImage } = req.body;
      if (profileImage === null || profileImage === '') {
        removals.profileImage = 1;
      } else if (
        typeof profileImage !== 'string' ||
        profileImage.length > 1200000 ||
        !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(profileImage)
      ) {
        return res.status(400).json({ success: false, message: 'Upload a JPEG, PNG, or WebP image smaller than 1 MB.' });
      } else {
        updates.profileImage = profileImage;
      }
    }

    if (!Object.keys(updates).length && !Object.keys(removals).length) {
      return res.status(400).json({ success: false, message: 'There are no profile changes to save.' });
    }
    const update = {};
    if (Object.keys(updates).length) update.$set = updates;
    if (Object.keys(removals).length) update.$unset = removals;
    const user = await User.findByIdAndUpdate(
      req.user.id,
      update,
      { new: true, runValidators: true }
    );
    if (!user) return res.status(404).json({ success: false, message: 'Account not found.' });
    return res.json({ success: true, message: 'Profile updated.', user });
  } catch (error) {
    return next(error);
  }
};

const logout = (_req, res) => {
  res.clearCookie('token', { ...cookieOptions(), maxAge: undefined });
  res.json({ success: true, message: 'Signed out.' });
};

module.exports = { sendOTP, verifyOTP, registerUser, loginUser, resetPassword, me, updateProfile, logout };
