const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeActiveServices } = require('../controllers/salonController');

test('public salon timers include only due active-service timing data', () => {
  const now = new Date('2026-11-10T12:00:00.000Z');
  const activeSalonId = 'salon-active';
  const futureSalonId = 'salon-future';
  const bookings = [
    {
      salonId: activeSalonId,
      appointmentDate: '2026-11-10',
      appointmentTimeZone: 'UTC',
      startedAt: new Date('2026-11-10T11:50:00.000Z'),
      services: [{ name: 'Haircut', durationMinutes: 30, price: 99 }],
      userId: 'private-customer-id',
    },
    {
      salonId: futureSalonId,
      appointmentDate: '2026-11-11',
      appointmentTimeZone: 'UTC',
      startedAt: new Date('2026-11-10T11:55:00.000Z'),
      services: [{ name: 'Color', durationMinutes: 45 }],
    },
  ];

  const activeServices = summarizeActiveServices(bookings, now);
  assert.deepEqual(activeServices.get(activeSalonId), {
    startedAt: bookings[0].startedAt,
    services: [{ name: 'Haircut', durationMinutes: 30 }],
  });
  assert.equal(activeServices.has(futureSalonId), false);
  assert.equal(JSON.stringify(activeServices.get(activeSalonId)).includes('private-customer-id'), false);
  assert.equal(JSON.stringify(activeServices.get(activeSalonId)).includes('"price"'), false);
});
