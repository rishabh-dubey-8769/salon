const Booking = require('../models/booking');
const { isAppointmentDateDue } = require('./appointmentDate');

const activeStatuses = ['waiting', 'in_service'];

const sortQueue = (bookings) =>
  bookings.sort((left, right) => {
    if (left.status !== right.status) return left.status === 'in_service' ? -1 : 1;
    if (left.status === 'in_service') return left.queueSequence - right.queueSequence;
    if (left.priority !== right.priority) return left.priority === 'express' ? -1 : 1;
    return left.queueSequence - right.queueSequence;
  });

const queueForSalon = async (salonId) => {
  const bookings = await Booking.find({ salonId, status: { $in: activeStatuses } })
    .populate('userId', 'name phone email contactPhone')
    .lean();
  const eligibleBookings = bookings.filter((booking) =>
    isAppointmentDateDue(booking.appointmentDate, booking.appointmentTimeZone || 'UTC')
  );
  sortQueue(eligibleBookings);

  let elapsedMinutes = 0;
  let waitingPosition = 0;
  return eligibleBookings.map((booking) => {
    const isInService = booking.status === 'in_service';
    if (!isInService) waitingPosition += 1;
    const serviceMinutes = booking.services.reduce((sum, service) => sum + service.durationMinutes, 0);
    const remainingMinutes = isInService && booking.startedAt
      ? Math.max(0, serviceMinutes - (Date.now() - new Date(booking.startedAt).getTime()) / 60_000)
      : serviceMinutes;
    const result = {
      ...booking,
      id: booking._id.toString(),
      user: booking.userId,
      queuePosition: isInService ? 0 : waitingPosition,
      estimatedWaitMinutes: isInService ? 0 : Math.ceil(elapsedMinutes),
    };
    elapsedMinutes += remainingMinutes;
    delete result._id;
    delete result.userId;
    return result;
  });
};

const refreshWaitEstimates = async (salonId) => {
  const queue = await queueForSalon(salonId);
  await Promise.all(
    queue
      .filter((booking) => booking.status === 'waiting')
      .map((booking) =>
        Booking.updateOne({ _id: booking.id }, { $set: { estimatedWaitMinutes: booking.estimatedWaitMinutes } })
      )
  );
  return queue;
};

module.exports = { queueForSalon, refreshWaitEstimates, sortQueue };
