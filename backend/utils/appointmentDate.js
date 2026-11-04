const formatDateInTimeZone = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const isValidTimeZone = (timeZone) => {
  if (typeof timeZone !== 'string' || !timeZone.trim() || timeZone.length > 100) return false;
  try {
    formatDateInTimeZone(new Date(), timeZone);
    return true;
  } catch {
    return false;
  }
};

const isValidAppointmentDate = (appointmentDate) => {
  if (typeof appointmentDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate)) return false;
  const date = new Date(`${appointmentDate}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === appointmentDate;
};

const localDateTimeToUtc = (date, time, timeZone) => {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const targetTime = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  let timestamp = targetTime;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value])
    );
    const representedTime = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    const difference = targetTime - representedTime;
    timestamp += difference;
    if (difference === 0) break;
  }
  return new Date(timestamp);
};

const isAppointmentDateAvailable = (appointmentDate, timeZone, now = new Date()) =>
  isValidAppointmentDate(appointmentDate) &&
  isValidTimeZone(timeZone) &&
  appointmentDate >= formatDateInTimeZone(now, timeZone);

const isAppointmentDateDue = (appointmentDate, timeZone = 'UTC', now = new Date()) =>
  !appointmentDate ||
  (isValidAppointmentDate(appointmentDate) &&
    isValidTimeZone(timeZone) &&
    appointmentDate <= formatDateInTimeZone(now, timeZone));

module.exports = {
  formatDateInTimeZone,
  isValidTimeZone,
  isValidAppointmentDate,
  localDateTimeToUtc,
  isAppointmentDateAvailable,
  isAppointmentDateDue,
};
