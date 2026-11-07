const mongoose = require('mongoose');
const Announcement = require('../models/announcement');

const MAX_ANNOUNCEMENT_DURATION_MS = 366 * 24 * 60 * 60 * 1000;
const allowedAudiences = new Set(['customers', 'salon_owners', 'both']);

const parseAnnouncement = (body) => {
  const audience = body?.audience;
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const startsAt = new Date(body?.startsAt);
  const expiresAt = new Date(body?.expiresAt);

  if (!allowedAudiences.has(audience)) {
    return { error: 'Choose customers, salon owners, or both as the audience.' };
  }
  if (!message || message.length > 2000) {
    return { error: 'The announcement must be between 1 and 2000 characters.' };
  }
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(expiresAt.getTime())) {
    return { error: 'Choose valid announcement start and end times.' };
  }
  if (expiresAt <= startsAt) {
    return { error: 'The end time must be after the start time.' };
  }
  if (expiresAt.getTime() - startsAt.getTime() > MAX_ANNOUNCEMENT_DURATION_MS) {
    return { error: 'An announcement cannot be scheduled for more than 366 days.' };
  }
  if (expiresAt <= new Date()) {
    return { error: 'The end time must be in the future.' };
  }
  return { announcement: { audience, message, startsAt, expiresAt } };
};

const listAdminAnnouncements = async (_req, res, next) => {
  try {
    const announcements = await Announcement.find({ expiresAt: { $gt: new Date() } })
      .sort({ startsAt: 1, createdAt: -1 })
      .limit(100);
    return res.json({ success: true, announcements });
  } catch (error) {
    return next(error);
  }
};

const createAnnouncement = async (req, res, next) => {
  try {
    const parsed = parseAnnouncement(req.body);
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });
    const announcement = await Announcement.create(parsed.announcement);
    return res.status(201).json({ success: true, announcement });
  } catch (error) {
    return next(error);
  }
};

const updateAnnouncement = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid announcement id.' });
    }
    const parsed = parseAnnouncement(req.body);
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });
    const announcement = await Announcement.findOneAndUpdate(
      { _id: req.params.id, expiresAt: { $gt: new Date() } },
      parsed.announcement,
      { new: true, runValidators: true }
    );
    if (!announcement) return res.status(404).json({ success: false, message: 'Announcement not found or already expired.' });
    return res.json({ success: true, announcement });
  } catch (error) {
    return next(error);
  }
};

const deleteAnnouncement = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid announcement id.' });
    }
    const announcement = await Announcement.findByIdAndDelete(req.params.id);
    if (!announcement) return res.status(404).json({ success: false, message: 'Announcement not found.' });
    return res.json({ success: true, message: 'Announcement deleted.' });
  } catch (error) {
    return next(error);
  }
};

const getActiveAnnouncement = async (req, res, next) => {
  try {
    const now = new Date();
    const activeQuery = {
      startsAt: { $lte: now },
      expiresAt: { $gt: now },
    };

    if (!req.user) {
      const active = await Announcement.exists(activeQuery);
      return res.json({ success: true, hasActiveAnnouncement: Boolean(active), announcement: null });
    }
    const audience = req.user.role === 'user'
      ? 'customers'
      : req.user.role === 'owner'
        ? 'salon_owners'
        : null;
    const announcement = audience
      ? await Announcement.findOne({
        ...activeQuery,
        audience: { $in: [audience, 'both'] },
      }).sort({ createdAt: -1 }).lean()
      : null;
    return res.json({
      success: true,
      hasActiveAnnouncement: Boolean(announcement),
      announcement: announcement ? {
        id: announcement._id.toString(),
        audience: announcement.audience,
        message: announcement.message,
        startsAt: announcement.startsAt,
        expiresAt: announcement.expiresAt,
      } : null,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listAdminAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  getActiveAnnouncement,
  parseAnnouncement,
};
