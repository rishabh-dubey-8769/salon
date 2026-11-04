const getUpiConfig = () => {
  const payeeAddress = String(process.env.ADMIN_UPI_ID || '').trim();
  const payeeName = String(process.env.ADMIN_UPI_NAME || '').trim();
  if (!/^[\w.-]{2,256}@[A-Za-z0-9.-]{2,64}$/.test(payeeAddress) || !payeeName) {
    const error = new Error('UPI payments are not configured. Set ADMIN_UPI_ID and ADMIN_UPI_NAME on the backend.');
    error.status = 503;
    throw error;
  }
  return { payeeAddress, payeeName };
};

const createUpiPaymentDetails = ({ bookingId, amount, payeeAddress, payeeName }) => {
  const reference = `SF${bookingId}`;
  const params = new URLSearchParams({
    pa: payeeAddress,
    pn: payeeName,
    tr: reference,
    tn: `SalonFlow booking ${bookingId}`,
    am: Number(amount).toFixed(2),
    cu: 'INR',
  });
  return {
    amount: Number(amount),
    payeeName,
    reference,
    upiUrl: `upi://pay?${params.toString()}`,
  };
};

const getUpiAdvanceAmount = (priority) => {
  if (priority === 'standard') return 1;
  if (priority === 'express') return 25;
  throw new Error('Invalid booking priority.');
};

module.exports = { getUpiConfig, createUpiPaymentDetails, getUpiAdvanceAmount };
