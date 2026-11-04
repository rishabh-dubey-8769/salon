const jwt = require('jsonwebtoken');

const generateToken = (userId) =>
  jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production' || process.env.COOKIE_SAME_SITE === 'none',
  sameSite: process.env.COOKIE_SAME_SITE || 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
});

module.exports = { generateToken, cookieOptions };
