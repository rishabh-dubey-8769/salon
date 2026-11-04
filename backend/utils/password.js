const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const prehashPassword = (password) =>
  crypto.createHash('sha256').update('SalonFlow password\0').update(password, 'utf8').digest('hex');

const hashPassword = (password) => bcrypt.hash(prehashPassword(password), 12);

const verifyPassword = async (password, passwordHash) => {
  if (await bcrypt.compare(prehashPassword(password), passwordHash)) {
    return { matches: true, needsRehash: false };
  }
  const legacyMatch = await bcrypt.compare(password, passwordHash);
  return { matches: legacyMatch, needsRehash: legacyMatch };
};

module.exports = { hashPassword, verifyPassword };
