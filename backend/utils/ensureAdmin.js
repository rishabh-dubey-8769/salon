const User = require('../models/user');
const { hashPassword } = require('./password');

const ensureAdmin = async () => {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';

  if (!email && !password) {
    console.warn('Admin bootstrap skipped. Set ADMIN_EMAIL and ADMIN_PASSWORD to create the initial admin account.');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Set a valid ADMIN_EMAIL.');
  }

  let user = await User.findOne({ email });
  if (user) {
    if (user.role !== 'admin') {
      throw new Error('ADMIN_EMAIL already belongs to a non-admin account. Choose a separate admin email.');
    }
    console.log('Admin account is ready.');
    return;
  }

  if (!password) {
    throw new Error('Set a non-empty ADMIN_PASSWORD.');
  }

  const admin = {
    name: 'SalonFlow Admin',
    email,
    passwordHash: await hashPassword(password),
    role: 'admin',
  };
  try {
    user = await User.findOneAndUpdate(
      { email },
      { $setOnInsert: admin },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    user = await User.findOne({ email });
  }

  if (!user || user.role !== 'admin') {
    throw new Error('ADMIN_EMAIL already belongs to a non-admin account. Choose a separate admin email.');
  }
  console.log('Admin account is ready.');
};

module.exports = ensureAdmin;
