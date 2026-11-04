const crypto = require('node:crypto');

const generateAccountUid = (role) => {
  if (!['user', 'owner'].includes(role)) {
    throw new Error('Account UIDs can only be generated for customers and salon owners.');
  }
  const prefix = role === 'owner' ? 'S' : 'C';
  const digits = Array.from({ length: 24 }, () => crypto.randomInt(0, 10)).join('');
  return `${prefix}${digits}`;
};

const createAccount = async (attributes) => {
  const User = require('../models/user');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await User.create(attributes);
    } catch (error) {
      if (error.code !== 11000 || !error.keyPattern?.uid) throw error;
      if (attempt === 4) {
        throw new Error('Could not allocate a unique account ID. Please try again.');
      }
    }
  }
  throw new Error('Could not allocate a unique account ID. Please try again.');
};

module.exports = { generateAccountUid, createAccount };
