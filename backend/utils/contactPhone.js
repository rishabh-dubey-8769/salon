const normalizeContactPhone = (value) => {
  if (typeof value !== 'string') return null;
  const phone = value.trim().replace(/[\s().-]/g, '');
  return /^\+?[1-9]\d{9,14}$/.test(phone) ? phone : null;
};

module.exports = normalizeContactPhone;
