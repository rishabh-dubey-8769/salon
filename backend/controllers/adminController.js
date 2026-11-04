const mongoose = require('mongoose');
const crypto = require('node:crypto');
const Salon = require('../models/salon');
const User = require('../models/user');
const Booking = require('../models/booking');
const { hashPassword } = require('../utils/password');
const { queueForSalon, refreshWaitEstimates } = require('../utils/queue');
const { buildReport, asCsv } = require('../utils/report');
const { normalizeSearchText, containsSearchText: textIncludesSearch } = require('../utils/searchText');
const { createAccount } = require('../utils/accountUid');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isNumericInput = (value) =>
  (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) &&
  Number.isFinite(Number(value));
const pagination = (query) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
};
const isDateOnly = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const containsSearchText = (field, search) => ({
  $expr: {
    $gte: [
      {
        $indexOfCP: [
          { $toLower: { $ifNull: [`$${field}`, ''] } },
          search.normalize('NFKC').toLowerCase(),
        ],
      },
      0,
    ],
  },
});
const accountUidQuery = (search) => /^[cs]\d{24}$/i.test(search)
  ? { uid: search.toUpperCase() }
  : { uid: { $regex: escapeRegex(search), $options: 'i' } };

const getReport = async (req, res, next) => {
  try {
    const report = await buildReport({ query: req.query });
    return res.json({ success: true, report });
  } catch (error) {
    if (error.message.startsWith('Invalid') || error.message.startsWith('Period') || error.message.startsWith('The from')) {
      error.status = 400;
    }
    return next(error);
  }
};

const downloadReport = async (req, res, next) => {
  try {
    const report = await buildReport({ query: req.query });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="salonflow-activity.csv"');
    return res.send(asCsv(report));
  } catch (error) {
    if (error.message.startsWith('Invalid') || error.message.startsWith('Period') || error.message.startsWith('The from')) {
      error.status = 400;
    }
    return next(error);
  }
};

const getPendingSalons = async (_req, res, next) => {
  try {
    const salons = await Salon.find({ isApproved: false })
      .populate('ownerId', 'name email uid phone')
      .sort({ createdAt: -1 })
      .lean();
    return res.json({
      success: true,
      salons: salons.map(({ _id, ...salon }) => ({ ...salon, id: _id.toString() })),
    });
  } catch (error) {
    return next(error);
  }
};

const setSalonApproval = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || typeof req.body.isApproved !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Provide a valid salon id and approval status.' });
    }
    const salon = await Salon.findByIdAndUpdate(
      req.params.id,
      { isApproved: req.body.isApproved },
      { new: true, runValidators: true }
    );
    if (!salon) return res.status(404).json({ success: false, message: 'Salon not found.' });
    return res.json({ success: true, salon });
  } catch (error) {
    return next(error);
  }
};

const getCustomers = async (req, res, next) => {
  try {
    const { page, limit, skip } = pagination(req.query);
    const query = { role: 'user' };
    if (req.query.search) {
      const rawSearch = String(req.query.search).trim().slice(0, 100);
      const search = escapeRegex(rawSearch);
      const normalizedSearch = normalizeSearchText(rawSearch);
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        accountUidQuery(rawSearch),
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { contactPhone: { $regex: search, $options: 'i' } },
        { 'location.label': { $regex: search, $options: 'i' } },
        { 'location.pinCode': { $regex: search, $options: 'i' } },
        containsSearchText('name', normalizedSearch),
        containsSearchText('email', normalizedSearch),
      ];
    }
    if (req.query.active === 'true') query.isActive = true;
    if (req.query.active === 'false') query.isActive = false;
    const [customers, total] = await Promise.all([
      User.find(query).select('uid name email phone contactPhone role gender dateOfBirth location isActive walletCredits createdAt updatedAt').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(query),
    ]);
    return res.json({
      success: true,
      customers: customers.map(({ _id, ...customer }) => ({
        ...customer,
        id: _id.toString(),
      })),
      page,
      pages: Math.ceil(total / limit),
      total,
    });
  } catch (error) {
    return next(error);
  }
};

const getCustomerOptions = async (_req, res, next) => {
  try {
    const customers = await User.find({ role: { $in: ['user', 'owner'] } })
      .select('uid name email role')
      .sort({ name: 1 })
      .lean();
    return res.json({
      success: true,
      customers: customers.map(({ _id, ...customer }) => ({ ...customer, id: _id.toString() })),
    });
  } catch (error) {
    return next(error);
  }
};

const updateCustomer = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid customer id.' });
    if (req.params.id === req.user.id) return res.status(403).json({ success: false, message: 'You cannot edit or block your own admin account here.' });
    const customer = await User.findById(req.params.id);
    if (!customer || customer.role === 'admin') return res.status(404).json({ success: false, message: 'Customer not found.' });

    const { name, email, phone, contactPhone, gender, dateOfBirth, location, role, isActive } = req.body;
    if (Object.hasOwn(req.body, 'name')) {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) return res.status(400).json({ success: false, message: 'Name must be between 1 and 80 characters.' });
      customer.name = name.trim();
    }
    if (Object.hasOwn(req.body, 'email')) {
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
      customer.email = normalizedEmail;
    }
    if (Object.hasOwn(req.body, 'phone')) {
      const normalizedPhone = typeof phone === 'string' ? phone.trim() : '';
      if (normalizedPhone && !/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) return res.status(400).json({ success: false, message: 'Phone must use international format or be blank.' });
      customer.phone = normalizedPhone || undefined;
    }
    if (Object.hasOwn(req.body, 'contactPhone')) {
      const normalizedPhone = typeof contactPhone === 'string' ? contactPhone.trim().replace(/[\s().-]/g, '') : '';
      if (normalizedPhone && !/^\+?[1-9]\d{9,14}$/.test(normalizedPhone)) return res.status(400).json({ success: false, message: 'Enter a valid contact phone or leave it blank.' });
      customer.contactPhone = normalizedPhone;
    }
    if (Object.hasOwn(req.body, 'gender')) {
      if (typeof gender !== 'string' || gender.length > 30) return res.status(400).json({ success: false, message: 'Gender must be 30 characters or fewer.' });
      customer.gender = gender.trim();
    }
    if (Object.hasOwn(req.body, 'profileImage')) {
      if (req.body.profileImage !== null && (typeof req.body.profileImage !== 'string' || req.body.profileImage.length > 1_200_000)) {
        return res.status(400).json({ success: false, message: 'Profile image is invalid or too large.' });
      }
      customer.profileImage = req.body.profileImage || undefined;
    }
    if (Object.hasOwn(req.body, 'dateOfBirth')) {
      const date = dateOfBirth ? new Date(dateOfBirth) : null;
      if (date && (Number.isNaN(date.getTime()) || date > new Date())) return res.status(400).json({ success: false, message: 'Enter a valid date of birth.' });
      customer.dateOfBirth = date || undefined;
    }
    if (Object.hasOwn(req.body, 'location')) {
      if (location === null) customer.location = undefined;
      else if (!location || typeof location.label !== 'string' ||
        (location.pinCode !== undefined && (typeof location.pinCode !== 'string' || location.pinCode.trim().length > 20)) ||
        (location.lat !== undefined && (!Number.isFinite(Number(location.lat)) || Number(location.lat) < -90 || Number(location.lat) > 90)) ||
        (location.lng !== undefined && (!Number.isFinite(Number(location.lng)) || Number(location.lng) < -180 || Number(location.lng) > 180))) {
        return res.status(400).json({ success: false, message: 'Provide a valid location.' });
      } else customer.location = { ...location, pinCode: (location.pinCode || '').trim() };
    }
    if (Object.hasOwn(req.body, 'role')) {
      if (!['user', 'owner'].includes(role)) return res.status(400).json({ success: false, message: 'Admin can assign only customer or owner roles.' });
      if (customer.role === 'owner' && role === 'user' && await Salon.exists({ ownerId: customer._id })) {
        return res.status(409).json({ success: false, message: 'Transfer or remove this user’s salon ownership before changing the role.' });
      }
      customer.role = role;
    }
    if (Object.hasOwn(req.body, 'isActive')) {
      if (typeof isActive !== 'boolean') return res.status(400).json({ success: false, message: 'isActive must be true or false.' });
      customer.isActive = isActive;
    }
    await customer.save();
    return res.json({ success: true, message: 'Customer details updated.', customer: customer.toObject() });
  } catch (error) {
    return next(error);
  }
};

const createCustomer = async (req, res, next) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const role = req.body.role || 'user';
    const location = req.body.location;
    if (!name || name.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['user', 'owner'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Provide a valid name, email, and customer or owner role.' });
    }
    if (location !== undefined && location !== null &&
      (!location || typeof location !== 'object' || Array.isArray(location) ||
        typeof location.label !== 'string' || location.label.length > 160 ||
        (location.pinCode !== undefined && (typeof location.pinCode !== 'string' || location.pinCode.trim().length > 20)) ||
        (location.lat !== undefined && (!Number.isFinite(Number(location.lat)) || Number(location.lat) < -90 || Number(location.lat) > 90)) ||
        (location.lng !== undefined && (!Number.isFinite(Number(location.lng)) || Number(location.lng) < -180 || Number(location.lng) > 180)) ||
        ((location.lat === undefined) !== (location.lng === undefined)))) {
      return res.status(400).json({ success: false, message: 'Provide a valid location.' });
    }
    if (await User.exists({ email })) return res.status(409).json({ success: false, message: 'An account already exists for this email.' });
    const temporaryPassword = crypto.randomBytes(32).toString('hex');
    const customer = await createAccount({
      name, email, role,
      passwordHash: await hashPassword(temporaryPassword),
      ...(location ? { location: { ...location, pinCode: (location.pinCode || '').trim() } } : {}),
    });
    return res.status(201).json({
      success: true,
      message: 'Account created. The user must use Forgot password with this email to set their own password.',
      customer: customer.toObject(),
    });
  } catch (error) {
    return next(error);
  }
};

const deleteCustomer = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid customer id.' });
    if (req.params.id === req.user.id) return res.status(403).json({ success: false, message: 'You cannot delete your own admin account.' });
    const customer = await User.findById(req.params.id);
    if (!customer || customer.role === 'admin') return res.status(404).json({ success: false, message: 'Customer not found.' });
    if (await Booking.exists({ userId: customer._id })) return res.status(409).json({ success: false, message: 'This account has booking history and cannot be permanently deleted. Block it instead to preserve records.' });
    if (await Salon.exists({ ownerId: customer._id })) return res.status(409).json({ success: false, message: 'This account owns salons and cannot be permanently deleted. Block it instead.' });
    await User.deleteOne({ _id: customer._id, role: { $ne: 'admin' } });
    return res.json({ success: true, message: 'Customer permanently deleted.' });
  } catch (error) {
    return next(error);
  }
};

const getManagedSalons = async (req, res, next) => {
  try {
    const { page, limit, skip } = pagination(req.query);
    const query = {};
    if (req.query.search) {
      const rawSearch = String(req.query.search).trim().slice(0, 100);
      const search = escapeRegex(rawSearch);
      const normalizedSearch = normalizeSearchText(rawSearch);
      const ownerQuery = /^[sS]\d{1,24}$/.test(rawSearch)
        ? { role: 'owner', ...accountUidQuery(rawSearch) }
        : { role: 'owner' };
      const owners = await User.find(ownerQuery).select('_id name email uid').lean();
      const matchingOwnerIds = owners
        .filter((owner) =>
          textIncludesSearch(owner.name, normalizedSearch) ||
          textIncludesSearch(owner.email, normalizedSearch) ||
          textIncludesSearch(owner.uid, normalizedSearch)
        )
        .map((owner) => owner._id);
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
        { address: { $regex: search, $options: 'i' } },
        { pinCode: { $regex: search, $options: 'i' } },
        { 'services.name': { $regex: search, $options: 'i' } },
        { 'services.category': { $regex: search, $options: 'i' } },
        containsSearchText('name', normalizedSearch),
        containsSearchText('city', normalizedSearch),
        containsSearchText('address', normalizedSearch),
        ...(matchingOwnerIds.length ? [{ ownerId: { $in: matchingOwnerIds } }] : []),
      ];
      if (isNumericInput(search)) query.$or.push({ 'services.price': Number(search) });
    }
    if (req.query.active === 'true') query.isActive = true;
    if (req.query.active === 'false') query.isActive = false;
    if (req.query.approved === 'true') query.isApproved = true;
    if (req.query.approved === 'false') query.isApproved = false;
    if (req.query.open === 'true') query.isOpen = true;
    if (req.query.open === 'false') query.isOpen = false;
    const [salons, total] = await Promise.all([
      Salon.find(query)
        .populate('ownerId', 'name email uid phone createdAt updatedAt isActive')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Salon.countDocuments(query),
    ]);
    return res.json({ success: true, salons, page, pages: Math.ceil(total / limit), total });
  } catch (error) {
    return next(error);
  }
};

const getSalonOptions = async (_req, res, next) => {
  try {
    const salons = await Salon.find({})
      .select('name city ownerId services.name services.category')
      .populate('ownerId', 'name email uid')
      .sort({ name: 1 })
      .lean();
    return res.json({
      success: true,
      salons: salons.map(({ _id, ownerId, ...salon }) => ({
        ...salon,
        id: _id.toString(),
        ownerName: ownerId?.name || '',
        ownerEmail: ownerId?.email || '',
        ownerUid: ownerId?.uid || '',
      })),
    });
  } catch (error) {
    return next(error);
  }
};

const createManagedSalon = async (req, res, next) => {
  try {
    const { ownerId, name, city, address, phone = '', lat, lng, pinCode = '', services } = req.body;
    if (!mongoose.isValidObjectId(ownerId) || !await User.exists({ _id: ownerId, role: 'owner' })) {
      return res.status(400).json({ success: false, message: 'Select a valid salon-owner account.' });
    }
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 ||
      typeof city !== 'string' || !city.trim() || city.trim().length > 80 ||
      typeof address !== 'string' || !address.trim() || address.trim().length > 200 ||
      typeof phone !== 'string' || phone.length > 20 ||
      !isNumericInput(lat) || Number(lat) < -90 || Number(lat) > 90 ||
      !isNumericInput(lng) || Number(lng) < -180 || Number(lng) > 180 ||
      typeof pinCode !== 'string' || pinCode.trim().length > 20 ||
      !Array.isArray(services) || !services.length) {
      return res.status(400).json({ success: false, message: 'Provide valid salon details, coordinates, and at least one service.' });
    }
    const salon = await Salon.create({ ownerId, name, city, address, phone, lat, lng, pinCode: pinCode.trim(), services, isApproved: false });
    return res.status(201).json({ success: true, message: 'Salon created and set to pending approval.', salon });
  } catch (error) {
    return next(error);
  }
};

const updateManagedSalon = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid salon id.' });
    const salon = await Salon.findById(req.params.id);
    if (!salon) return res.status(404).json({ success: false, message: 'Salon not found.' });
    const { ownerId, name, city, address, phone, lat, lng, pinCode, services, image, isActive, isApproved, isOpen } = req.body;
    const nextName = name === undefined ? salon.name : name;
    const nextCity = city === undefined ? salon.city : city;
    const nextAddress = address === undefined ? salon.address : address;
    const nextPhone = phone === undefined ? salon.phone || '' : phone;
    const nextLat = lat === undefined ? salon.lat : lat;
    const nextLng = lng === undefined ? salon.lng : lng;
    const nextPinCode = pinCode === undefined ? salon.pinCode || '' : pinCode;
    const nextServices = services === undefined ? salon.services : services;
    if (
      typeof nextName !== 'string' || !nextName.trim() || nextName.trim().length > 100 ||
      typeof nextCity !== 'string' || !nextCity.trim() || nextCity.trim().length > 80 ||
      typeof nextAddress !== 'string' || !nextAddress.trim() || nextAddress.trim().length > 200 ||
      typeof nextPhone !== 'string' || nextPhone.length > 20 ||
      !isNumericInput(nextLat) || Number(nextLat) < -90 || Number(nextLat) > 90 ||
      !isNumericInput(nextLng) || Number(nextLng) < -180 || Number(nextLng) > 180 ||
      typeof nextPinCode !== 'string' || nextPinCode.trim().length > 20 ||
      !Array.isArray(nextServices) || nextServices.length === 0
    ) return res.status(400).json({ success: false, message: 'Provide valid salon details, coordinates, and at least one service.' });

    const oldServices = new Map(salon.services.map((service) => [service._id.toString(), service]));
    const normalizedServices = [];
    for (const service of nextServices) {
      if (!service || typeof service.name !== 'string' || !service.name.trim() || service.name.trim().length > 80 ||
        typeof service.category !== 'string' || !service.category.trim() || service.category.trim().length > 40 ||
        !isNumericInput(service.price) || Number(service.price) < 0 ||
        !isNumericInput(service.durationMinutes) || !Number.isInteger(Number(service.durationMinutes)) ||
        Number(service.durationMinutes) < 5 || Number(service.durationMinutes) > 300) {
        return res.status(400).json({ success: false, message: 'Each service needs a name, category, valid non-negative price, and duration between 5 and 300 minutes.' });
      }
      if (service._id && (!mongoose.isValidObjectId(service._id) || !oldServices.has(String(service._id)))) {
        return res.status(400).json({ success: false, message: 'A service id is invalid or does not belong to this salon.' });
      }
      normalizedServices.push({
        ...(service._id ? { _id: service._id } : {}),
        name: service.name.trim(),
        category: service.category.trim(),
        price: Number(service.price),
        durationMinutes: Number(service.durationMinutes),
      });
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') return res.status(400).json({ success: false, message: 'isActive must be true or false.' });
    if (isApproved !== undefined && typeof isApproved !== 'boolean') return res.status(400).json({ success: false, message: 'isApproved must be true or false.' });
    if (isOpen !== undefined && typeof isOpen !== 'boolean') return res.status(400).json({ success: false, message: 'isOpen must be true or false.' });
    if (ownerId !== undefined && (!mongoose.isValidObjectId(ownerId) || !await User.exists({ _id: ownerId, role: 'owner' }))) {
      return res.status(400).json({ success: false, message: 'Select a valid salon-owner account.' });
    }
    salon.name = nextName.trim();
    salon.city = nextCity.trim();
    salon.address = nextAddress.trim();
    salon.phone = nextPhone.trim();
    salon.lat = Number(nextLat);
    salon.lng = Number(nextLng);
    salon.pinCode = nextPinCode.trim();
    salon.services = normalizedServices;
    if (ownerId !== undefined) salon.ownerId = ownerId;
    if (image !== undefined) {
      if (typeof image !== 'string' || image.length > 2_000_000) return res.status(400).json({ success: false, message: 'Salon image value is invalid or too large.' });
      salon.image = image;
    }
    if (isActive !== undefined) salon.isActive = isActive;
    if (isApproved !== undefined) salon.isApproved = isApproved;
    if (isOpen !== undefined) salon.isOpen = isOpen;
    await salon.save();
    return res.json({ success: true, message: 'Salon details updated.', salon });
  } catch (error) {
    return next(error);
  }
};

const deleteManagedSalon = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid salon id.' });
    const salon = await Salon.findById(req.params.id);
    if (!salon) return res.status(404).json({ success: false, message: 'Salon not found.' });
    const retainedBookings = await Booking.countDocuments({ salonId: salon._id });
    await Booking.updateMany(
      { salonId: salon._id, 'salonSnapshot.id': { $exists: false } },
      {
        $set: {
          salonSnapshot: {
            id: salon._id.toString(),
            name: salon.name,
            city: salon.city,
            address: salon.address,
            phone: salon.phone || '',
          },
        },
      }
    );
    await Salon.deleteOne({ _id: salon._id });
    return res.json({
      success: true,
      message: `Salon profile permanently deleted. ${retainedBookings} booking record${retainedBookings === 1 ? '' : 's'} retained as history.`,
    });
  } catch (error) {
    return next(error);
  }
};

const getManagedBookings = async (req, res, next) => {
  try {
    const { page, limit, skip } = pagination(req.query);
    const query = {};
    const { fromDate, toDate } = req.query;
    if ((fromDate && !isDateOnly(fromDate)) || (toDate && !isDateOnly(toDate))) {
      return res.status(400).json({ success: false, message: 'Booking date filters must be valid calendar dates.' });
    }
    if (fromDate && toDate && fromDate > toDate) {
      return res.status(400).json({ success: false, message: 'The start date must be on or before the end date.' });
    }
    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = new Date(`${fromDate}T00:00:00.000Z`);
      if (toDate) query.createdAt.$lt = new Date(new Date(`${toDate}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);
    }
    if (req.query.status && ['pending_payment', 'waiting', 'in_service', 'completed', 'cancelled', 'rejected'].includes(req.query.status)) query.status = req.query.status;
    if (req.query.salonId) {
      if (!mongoose.isValidObjectId(req.query.salonId)) return res.status(400).json({ success: false, message: 'Invalid salon filter.' });
      query.salonId = req.query.salonId;
    }
    if (req.query.customerId) {
      if (!mongoose.isValidObjectId(req.query.customerId)) return res.status(400).json({ success: false, message: 'Invalid customer filter.' });
      query.userId = req.query.customerId;
    }
    if (req.query.search) {
      const rawSearch = String(req.query.search).trim().slice(0, 100);
      const search = escapeRegex(rawSearch);
      const [users, owners, salons] = await Promise.all([
        User.find({ $or: [accountUidQuery(rawSearch), { name: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }, { phone: { $regex: search, $options: 'i' } }, { contactPhone: { $regex: search, $options: 'i' } }] }).select('_id').limit(200).lean(),
        User.find({ role: 'owner', ...accountUidQuery(rawSearch) }).select('_id').limit(200).lean(),
        Salon.find({
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { city: { $regex: search, $options: 'i' } },
            { address: { $regex: search, $options: 'i' } },
            { 'services.name': { $regex: search, $options: 'i' } },
            ...(owners.length ? [{ ownerId: { $in: owners.map((owner) => owner._id) } }] : []),
          ],
        }).select('_id').limit(200).lean(),
      ]);
      query.$or = [
        { userId: { $in: users.map((user) => user._id) } },
        { salonId: { $in: salons.map((salon) => salon._id) } },
        { 'services.name': { $regex: search, $options: 'i' } },
        { 'salonSnapshot.name': { $regex: search, $options: 'i' } },
        { upiReference: { $regex: search, $options: 'i' } },
      ];
    }
    const [bookings, total] = await Promise.all([
      Booking.find(query)
        .populate('userId', 'uid name email phone contactPhone role isActive')
        .populate({ path: 'salonId', select: 'name city isActive ownerId', populate: { path: 'ownerId', select: 'uid name' } })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Booking.countDocuments(query),
    ]);
    return res.json({ success: true, bookings, page, pages: Math.ceil(total / limit), total });
  } catch (error) {
    return next(error);
  }
};

const updateManagedBookingStatus = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid booking id.' });
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found.' });
    const { status } = req.body;
    const changes = {};
    if (status === 'in_service' && booking.status === 'waiting') {
      const queue = await queueForSalon(booking.salonId);
      if (queue.find((entry) => entry.status === 'waiting')?.id !== booking.id) {
        return res.status(409).json({ success: false, message: 'Serve the next customer in the queue first.' });
      }
      changes.status = 'in_service';
      changes.startedAt = new Date();
    } else if (status === 'completed' && booking.status === 'in_service') {
      changes.status = 'completed';
      changes.completedAt = new Date();
    } else {
      return res.status(400).json({ success: false, message: 'Admin status changes are limited to the next FIFO start or completing an in-service booking. Payment details cannot be changed here.' });
    }
    const updatedBooking = await Booking.findOneAndUpdate(
      { _id: booking._id, status: booking.status },
      { $set: changes },
      { new: true, runValidators: true }
    );
    if (!updatedBooking) return res.status(409).json({ success: false, message: 'Booking status changed. Refresh and try again.' });
    if (status === 'completed') {
      await User.updateOne({ _id: booking.userId, activeBookingCount: { $gt: 0 } }, { $inc: { activeBookingCount: -1 } });
    }
    await refreshWaitEstimates(booking.salonId);
    return res.json({ success: true, message: `Booking marked ${status.replace('_', ' ')}.`, booking: updatedBooking });
  } catch (error) {
    return next(error);
  }
};

const confirmManagedBookingPayment = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid booking id.' });
    }
    const booking = await Booking.findOneAndUpdate(
      {
        _id: req.params.id,
        paymentMethod: 'upi_manual',
        paymentStatus: 'pending',
        status: 'pending_payment',
        upiReference: { $exists: true },
      },
      {
        $set: {
          paymentStatus: 'paid',
          status: 'waiting',
          paymentVerifiedAt: new Date(),
          paymentVerifiedBy: req.user._id,
        },
        $unset: { paymentExpiresAt: 1 },
      },
      { new: true, runValidators: true }
    );
    if (!booking) {
      return res.status(409).json({
        success: false,
        message: 'This booking has no submitted UPI reference or is no longer awaiting payment verification.',
      });
    }
    await refreshWaitEstimates(booking.salonId);
    return res.json({
      success: true,
      message: 'Payment marked received and booking added to the queue.',
      booking,
    });
  } catch (error) {
    return next(error);
  }
};

const rejectManagedBookingPayment = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid booking id.' });
    }
    const booking = await Booking.findOneAndUpdate(
      {
        _id: req.params.id,
        paymentMethod: 'upi_manual',
        paymentStatus: 'pending',
        status: 'pending_payment',
        upiReference: { $exists: true },
      },
      { $set: { paymentStatus: 'failed', status: 'cancelled', cancelledAt: new Date() } },
      { new: true, runValidators: true }
    );
    if (!booking) {
      return res.status(409).json({
        success: false,
        message: 'This booking has no submitted UPI reference or is no longer awaiting review.',
      });
    }
    await User.updateOne(
      { _id: booking.userId, activeBookingCount: { $gt: 0 } },
      { $inc: { activeBookingCount: -1 } }
    );
    await refreshWaitEstimates(booking.salonId);
    return res.json({ success: true, message: 'Payment was not confirmed; the booking was cancelled.', booking });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getReport,
  downloadReport,
  getPendingSalons,
  setSalonApproval,
  getCustomers,
  getCustomerOptions,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getManagedSalons,
  getSalonOptions,
  createManagedSalon,
  updateManagedSalon,
  deleteManagedSalon,
  getManagedBookings,
  updateManagedBookingStatus,
  confirmManagedBookingPayment,
  rejectManagedBookingPayment,
};
