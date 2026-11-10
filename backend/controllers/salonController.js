const mongoose = require('mongoose');
const Salon = require('../models/salon');
const Booking = require('../models/booking');
const Rating = require('../models/rating');
const User = require('../models/user');
const distanceKm = require('../utils/distance');
const { isAppointmentDateDue } = require('../utils/appointmentDate');
const isNumericInput = (value) =>
  (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) &&
  Number.isFinite(Number(value));
const isCoordinate = (value, minimum, maximum) =>
  isNumericInput(value) && Number(value) >= minimum && Number(value) <= maximum;
const isValidImageDataUrl = (value) =>
  typeof value === 'string' &&
  value.length <= 400_000 &&
  /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
const isValidSalonLogo = (value) =>
  value === undefined || value === null || value === '' ||
  isValidImageDataUrl(value) ||
  (typeof value === 'string' && value.length <= 2048 && /^https?:\/\/\S+$/i.test(value));
const areValidSalonPhotos = (photos, logo) => {
  if (photos === undefined) return true;
  if (!Array.isArray(photos) || photos.length > 5 || !photos.every(isValidImageDataUrl)) return false;
  return [logo, ...photos].reduce((total, image) => total + (typeof image === 'string' ? image.length : 0), 0) <= 1_400_000;
};
const summarizeActiveServices = (bookings, now = new Date()) => {
  const activeServiceBySalon = new Map();
  for (const booking of bookings) {
    const salonId = booking.salonId.toString();
    if (activeServiceBySalon.has(salonId) ||
      !isAppointmentDateDue(booking.appointmentDate, booking.appointmentTimeZone || 'UTC', now)) continue;
    activeServiceBySalon.set(salonId, {
      startedAt: booking.startedAt,
      services: booking.services.map(({ name, durationMinutes }) => ({ name, durationMinutes })),
    });
  }
  return activeServiceBySalon;
};

const getSalons = async (req, res, next) => {
  try {
    const { search, city, openNow, maxWait, maxPrice, maxDistanceKm, lat, lng } = req.query;
    for (const [label, value] of Object.entries({ maxWait, maxPrice, maxDistanceKm })) {
      if (value !== undefined && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
        return res.status(400).json({ success: false, message: `${label} must be a non-negative number.` });
      }
    }
    const query = { isApproved: true, isActive: true };
    if (openNow === 'true') query.isOpen = true;
    if (city) query.city = { $regex: String(city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (search) {
      const safeSearch = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { name: { $regex: safeSearch, $options: 'i' } },
        { address: { $regex: safeSearch, $options: 'i' } },
        { city: { $regex: safeSearch, $options: 'i' } },
      ];
    }
    if (maxPrice !== undefined && Number.isFinite(Number(maxPrice))) {
      query.services = { $elemMatch: { price: { $lte: Number(maxPrice) } } };
    }

    const salons = await Salon.find(query).sort({ rating: -1, name: 1 }).limit(100).lean();
    const ids = salons.map((salon) => salon._id);
    const now = new Date();
    const queueStats = await Booking.aggregate([
      { $match: { salonId: { $in: ids }, status: { $in: ['waiting', 'in_service'] } } },
      {
        $match: {
          $or: [
            { appointmentDate: { $exists: false } },
            {
              $expr: {
                $lte: [
                  '$appointmentDate',
                  {
                    $dateToString: {
                      date: '$$NOW',
                      format: '%Y-%m-%d',
                      timezone: { $ifNull: ['$appointmentTimeZone', 'UTC'] },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
      {
        $addFields: {
          serviceMinutes: {
            $reduce: {
              input: '$services',
              initialValue: 0,
              in: { $add: ['$$value', '$$this.durationMinutes'] },
            },
          },
        },
      },
      {
        $addFields: {
          minutesLeft: {
            $min: [
              '$serviceMinutes',
              {
                $max: [
                  0,
                  {
                    $subtract: [
                      '$serviceMinutes',
                      {
                        $floor: {
                          $divide: [
                            { $subtract: [now, { $ifNull: ['$startedAt', now] }] },
                            60_000,
                          ],
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
      {
        $group: {
          _id: '$salonId',
          peopleWaiting: { $sum: { $cond: [{ $eq: ['$status', 'waiting'] }, 1, 0] } },
          estimatedMinutes: { $sum: '$minutesLeft' },
        },
      },
    ]);
    const [statsById, ratingRows] = [
      new Map(queueStats.map((row) => [row._id.toString(), row])),
      await Rating.aggregate([
        { $match: { salonId: { $in: ids } } },
        { $group: { _id: '$salonId', average: { $avg: '$value' }, count: { $sum: 1 } } },
      ]),
    ];
    const activeBookings = ids.length
      ? await Booking.find({ salonId: { $in: ids }, status: 'in_service' })
        .select('salonId startedAt services appointmentDate appointmentTimeZone')
        .sort({ startedAt: 1 })
        .lean()
      : [];
    const activeServiceBySalon = summarizeActiveServices(activeBookings, now);
    const ratingsById = new Map(ratingRows.map((row) => [row._id.toString(), row]));
    const latitude = Number(lat);
    const longitude = Number(lng);
    const hasLocation =
      typeof lat === 'string' &&
      lat.trim() !== '' &&
      typeof lng === 'string' &&
      lng.trim() !== '' &&
      Number.isFinite(latitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      Number.isFinite(longitude) &&
      longitude >= -180 &&
      longitude <= 180;
    if (maxDistanceKm !== undefined && !hasLocation) {
      return res.status(400).json({ success: false, message: 'A valid latitude and longitude are required for distance filtering.' });
    }
    let result = salons.map((salon) => {
      const stats = statsById.get(salon._id.toString()) || { peopleWaiting: 0, estimatedMinutes: 0 };
      const ratingStats = ratingsById.get(salon._id.toString()) || { average: 0, count: 0 };
      return {
        ...salon,
        id: salon._id.toString(),
        rating: ratingStats.average,
        ratingCount: ratingStats.count,
        queueCount: stats.peopleWaiting,
        waitMinutes: Math.ceil(stats.estimatedMinutes),
        activeService: activeServiceBySalon.get(salon._id.toString()) || null,
        distanceKm: hasLocation ? distanceKm(latitude, longitude, salon.lat, salon.lng) : null,
      };
    });

    if (maxWait !== undefined && Number.isFinite(Number(maxWait))) {
      result = result.filter((salon) => salon.waitMinutes <= Number(maxWait));
    }
    if (maxDistanceKm !== undefined && hasLocation && Number.isFinite(Number(maxDistanceKm))) {
      result = result.filter((salon) => salon.distanceKm <= Number(maxDistanceKm));
    }
    if (hasLocation) result.sort((left, right) => left.distanceKm - right.distanceKm);
    else result.sort((left, right) => right.rating - left.rating || left.name.localeCompare(right.name));

    return res.json({ success: true, count: result.length, serverTime: new Date().toISOString(), salons: result });
  } catch (error) {
    return next(error);
  }
};

const getMySalonRatings = async (req, res, next) => {
  try {
    const ratings = await Rating.find({ userId: req.user.id }).select('salonId value').lean();
    return res.json({
      success: true,
      ratings: Object.fromEntries(ratings.map((rating) => [rating.salonId.toString(), rating.value])),
    });
  } catch (error) {
    return next(error);
  }
};

const rateSalon = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid salon id.' });
    }
    const { rating } = req.body;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Choose a whole-star rating from 1 to 5.' });
    }
    const salon = await Salon.findOne({ _id: req.params.id, isApproved: true, isActive: true }).select('_id');
    if (!salon) return res.status(404).json({ success: false, message: 'Salon not found.' });

    await Rating.findOneAndUpdate(
      { salonId: salon._id, userId: req.user.id },
      { $set: { value: rating } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    const [ratingStats] = await Rating.aggregate([
      { $match: { salonId: salon._id } },
      { $group: { _id: '$salonId', average: { $avg: '$value' }, count: { $sum: 1 } } },
    ]);
    return res.json({
      success: true,
      rating,
      average: ratingStats?.average || 0,
      ratingCount: ratingStats?.count || 0,
      message: 'Your salon rating has been saved.',
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Your rating is being saved. Please try again.' });
    }
    return next(error);
  }
};

const getSalonById = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid salon id.' });
    }
    const salon = await Salon.findOne({ _id: req.params.id, isApproved: true, isActive: true });
    if (!salon) return res.status(404).json({ success: false, message: 'Salon not found.' });
    return res.json({ success: true, salon });
  } catch (error) {
    return next(error);
  }
};

const createSalon = async (req, res, next) => {
  try {
    const { name, city, address, phone, lat, lng, pinCode = '', services, image, images } = req.body;
    if (
      !name || !city || !address || !Array.isArray(services) || services.length === 0 ||
      !isCoordinate(lat, -90, 90) || !isCoordinate(lng, -180, 180) ||
      typeof pinCode !== 'string' || pinCode.trim().length > 20 ||
      !isValidSalonLogo(image) || !areValidSalonPhotos(images, image)
    ) {
      return res.status(400).json({ success: false, message: 'Salon name, city, address, valid coordinates, and services are required.' });
    }
    const salon = await Salon.create({
      ownerId: req.user.id,
      name,
      city,
      address,
      phone,
      lat: Number(lat),
      lng: Number(lng),
      pinCode: pinCode.trim(),
      services,
      image,
      images: images || [],
      isApproved: false,
    });
    return res.status(201).json({
      success: true,
      message: 'Salon submitted for admin approval.',
      salon,
    });
  } catch (error) {
    return next(error);
  }
};

const updateMySalon = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid salon id.' });
    }

    const { name, city, address, phone, lat, lng, pinCode, services, image, images } = req.body;
    if (
      typeof name !== 'string' || !name.trim() || name.trim().length > 100 ||
      typeof city !== 'string' || !city.trim() || city.trim().length > 80 ||
      typeof address !== 'string' || !address.trim() || address.trim().length > 200 ||
      typeof phone !== 'string' || phone.length > 20 ||
      !isCoordinate(lat, -90, 90) ||
      !isCoordinate(lng, -180, 180) ||
      (pinCode !== undefined && (typeof pinCode !== 'string' || pinCode.trim().length > 20)) ||
      !Array.isArray(services) || services.length === 0 ||
      !isValidSalonLogo(image) || !areValidSalonPhotos(images, image)
    ) {
      return res.status(400).json({ success: false, message: 'Provide valid salon details, coordinates, and at least one service.' });
    }

    const salon = await Salon.findOne({ _id: req.params.id, ownerId: req.user.id });
    if (!salon) return res.status(404).json({ success: false, message: 'Salon not found.' });

    const existingServices = new Map(salon.services.map((service) => [service._id.toString(), service]));
    const normalizedServices = [];
    for (const service of services) {
      if (
        !service || typeof service.name !== 'string' || !service.name.trim() || service.name.trim().length > 80 ||
        typeof service.category !== 'string' || !service.category.trim() || service.category.trim().length > 40 ||
        !isNumericInput(service.price) || Number(service.price) < 0 ||
        !isNumericInput(service.durationMinutes) || !Number.isInteger(Number(service.durationMinutes)) ||
        Number(service.durationMinutes) < 5 || Number(service.durationMinutes) > 300
      ) {
        return res.status(400).json({ success: false, message: 'Each service needs a name, category, valid non-negative price, and duration between 5 and 300 minutes.' });
      }

      const { _id } = service;
      if (_id && (!mongoose.isValidObjectId(_id) || !existingServices.has(String(_id)))) {
        return res.status(400).json({ success: false, message: 'A service id is invalid or does not belong to this salon.' });
      }
      normalizedServices.push({
        ...(_id ? { _id } : {}),
        name: service.name.trim(),
        category: service.category.trim(),
        price: Number(service.price),
        durationMinutes: Number(service.durationMinutes),
      });
    }

    salon.name = name.trim();
    salon.city = city.trim();
    salon.address = address.trim();
    salon.phone = phone.trim();
    salon.lat = Number(lat);
    salon.lng = Number(lng);
    if (pinCode !== undefined) salon.pinCode = pinCode.trim();
    salon.services = normalizedServices;
    if (Object.hasOwn(req.body, 'image')) salon.image = image || undefined;
    if (Object.hasOwn(req.body, 'images')) salon.images = images;
    await salon.save();
    return res.json({ success: true, message: 'Salon details saved.', salon });
  } catch (error) {
    return next(error);
  }
};

const getMySalons = async (req, res, next) => {
  try {
    const salons = await Salon.find({ ownerId: req.user.id }).sort({ createdAt: -1 });
    return res.json({ success: true, salons });
  } catch (error) {
    return next(error);
  }
};

const setOpenStatus = async (req, res, next) => {
  try {
    const { isOpen } = req.body;
    if (typeof isOpen !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isOpen must be true or false.' });
    }
    const salon = await Salon.findOneAndUpdate(
      { _id: req.params.id, ownerId: req.user.id },
      { isOpen },
      { new: true, runValidators: true }
    );
    if (!salon) return res.status(404).json({ success: false, message: 'Salon not found.' });
    return res.json({ success: true, salon });
  } catch (error) {
    return next(error);
  }
};

const setCustomerBlock = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.customerId)) {
      return res.status(400).json({ success: false, message: 'Invalid salon or customer id.' });
    }
    const { blocked } = req.body;
    if (typeof blocked !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Choose whether to block or unblock this customer.' });
    }
    const customer = await User.findOne({ _id: req.params.customerId, role: 'user' }).select('_id');
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found.' });
    const salon = await Salon.findOne({ _id: req.params.id, ownerId: req.user.id });
    if (!salon) return res.status(404).json({ success: false, message: 'Salon not found.' });

    if (blocked) {
      await Salon.updateOne({ _id: salon._id }, { $addToSet: { blockedCustomerIds: customer._id } });
    } else {
      await Salon.updateOne({ _id: salon._id }, { $pull: { blockedCustomerIds: customer._id } });
    }
    return res.json({
      success: true,
      blocked,
      message: blocked
        ? 'This customer cannot make new bookings at this salon.'
        : 'This customer can book this salon again.',
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getSalons,
  summarizeActiveServices,
  getSalonById,
  createSalon,
  updateMySalon,
  getMySalons,
  getMySalonRatings,
  rateSalon,
  setOpenStatus,
  setCustomerBlock,
};
