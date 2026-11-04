const mongoose = require('mongoose');
const Booking = require('../models/booking');
const Salon = require('../models/salon');

const getPeriodBounds = (query, now = new Date()) => {
  const period = query.period || 'month';
  let start;
  if (query.from) {
    start = new Date(query.from);
    if (Number.isNaN(start.getTime())) throw new Error('Invalid from date.');
    start.setUTCHours(0, 0, 0, 0);
  } else if (period === 'day') {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  } else if (period === 'week') {
    const daysSinceMonday = (now.getUTCDay() + 6) % 7;
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday));
  } else if (period === 'year') {
    start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  } else if (period === 'month') {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  } else {
    throw new Error('Period must be day, week, month, or year.');
  }

  const end = query.to ? new Date(query.to) : now;
  if (Number.isNaN(end.getTime())) throw new Error('Invalid to date.');
  end.setUTCHours(23, 59, 59, 999);
  if (start > end) throw new Error('The from date must be on or before the to date.');
  return { start, end };
};

const buildReport = async ({ query, ownerId } = {}) => {
  const { start, end } = getPeriodBounds(query || {});
  const match = {
    createdAt: { $gte: start, $lte: end },
    paymentStatus: 'paid',
    status: { $nin: ['cancelled', 'rejected'] },
  };
  if (query?.salonId) {
    if (!mongoose.isValidObjectId(query.salonId)) throw new Error('Invalid salon id.');
    match.salonId = new mongoose.Types.ObjectId(query.salonId);
  }
  if (query?.customerId) {
    if (!mongoose.isValidObjectId(query.customerId)) throw new Error('Invalid customer id.');
    match.userId = new mongoose.Types.ObjectId(query.customerId);
  }
  if (ownerId) {
    const salons = await Salon.find({ ownerId }).select('_id').lean();
    const allowedIds = salons.map((salon) => salon._id);
    if (match.salonId && !allowedIds.some((id) => id.equals(match.salonId))) {
      return {
        from: start,
        to: end,
        totalRevenue: 0,
        onlineCollected: 0,
        paidOrders: 0,
        services: [],
        salons: [],
        bookings: [],
      };
    }
    match.salonId = match.salonId || { $in: allowedIds };
  }
  if (query?.serviceCategory) {
    match['services.category'] = query.serviceCategory;
  }

  const bookings = await Booking.find(match)
    .populate('salonId', 'name city')
    .populate('userId', 'name')
    .sort({ createdAt: -1 })
    .limit(10_000)
    .lean();
  const categories = new Map();
  const salons = new Map();
  let totalRevenue = 0;
  let onlineCollected = 0;
  for (const booking of bookings) {
    const matchedServices = query?.serviceCategory
      ? booking.services.filter((service) => service.category === query.serviceCategory)
      : booking.services;
    const serviceRevenue = matchedServices.reduce((sum, service) => sum + service.price, 0);
    totalRevenue += serviceRevenue;
    const salonOnlineCollected = ownerId && booking.paymentMethod === 'upi_manual'
      ? 0
      : booking.paymentAmount;
    onlineCollected += salonOnlineCollected;
    const salonId = booking.salonId?._id?.toString() || booking.salonSnapshot?.id || '';
    const salonRow = salons.get(salonId) || {
      salonId,
      salonName: booking.salonId?.name || booking.salonSnapshot?.name || 'Unknown salon',
      orders: 0,
      revenue: 0,
      onlineCollected: 0,
    };
    salonRow.orders += 1;
    salonRow.revenue += serviceRevenue;
    salonRow.onlineCollected += salonOnlineCollected;
    salons.set(salonId, salonRow);
    const countedCategories = new Set();
    for (const service of matchedServices) {
      const row = categories.get(service.category) || { category: service.category, orders: 0, revenue: 0 };
      if (!countedCategories.has(service.category)) {
        row.orders += 1;
        countedCategories.add(service.category);
      }
      row.revenue += service.price;
      categories.set(service.category, row);
    }
  }

  return {
    from: start,
    to: end,
    totalRevenue,
    onlineCollected,
    paidOrders: bookings.length,
    services: [...categories.values()].sort((a, b) => b.revenue - a.revenue),
    salons: [...salons.values()].sort((a, b) => b.revenue - a.revenue),
    bookings: bookings.map((booking) => ({
      id: booking._id.toString(),
      salon: booking.salonId?.name || booking.salonSnapshot?.name || 'Unknown salon',
      customer: booking.userId?.name || 'Customer',
      services: (query?.serviceCategory
        ? booking.services.filter((service) => service.category === query.serviceCategory)
        : booking.services).map((service) => service.name).join(', '),
      total: (query?.serviceCategory
        ? booking.services.filter((service) => service.category === query.serviceCategory)
        : booking.services).reduce((sum, service) => sum + service.price, 0),
      paymentAmount: booking.paymentAmount,
      paymentMode: booking.paymentMode,
      priority: booking.priority,
      status: booking.status,
      createdAt: booking.createdAt,
    })),
  };
};

const asCsv = (report) => {
  const cell = (value) => {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const lines = [
    ['Booking ID', 'Salon', 'Customer', 'Services', 'Total INR', 'Paid INR', 'Payment mode', 'Priority', 'Status', 'Created at'].map(cell).join(','),
    ...report.bookings.map((row) =>
      [row.id, row.salon, row.customer, row.services, row.total, row.paymentAmount, row.paymentMode, row.priority, row.status, row.createdAt]
        .map(cell)
        .join(',')
    ),
  ];
  return lines.join('\r\n');
};

module.exports = { buildReport, asCsv, getPeriodBounds };
