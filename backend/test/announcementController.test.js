const test = require('node:test');
const assert = require('node:assert/strict');
const Announcement = require('../models/announcement');
const {
  getActiveAnnouncement,
  parseAnnouncement,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} = require('../controllers/announcementController');

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test('announcement inputs require supported audiences, valid dates, and a future expiry', () => {
  const valid = parseAnnouncement({
    audience: 'both',
    message: 'SalonFlow will be briefly unavailable.',
    startsAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(valid.error, undefined);
  assert.equal(valid.announcement.audience, 'both');

  assert.match(parseAnnouncement({
    audience: 'everyone',
    message: 'Hello',
    startsAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }).error, /audience/i);
  assert.match(parseAnnouncement({
    audience: 'customers',
    message: 'Hello',
    startsAt: new Date(Date.now() + 60_000).toISOString(),
    expiresAt: new Date().toISOString(),
  }).error, /end time/i);
  assert.match(parseAnnouncement({
    audience: 'customers',
    message: 'Hello',
    startsAt: new Date(Date.now() - 120_000).toISOString(),
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  }).error, /future/i);
});

test('active announcement content is visible only to its selected audience', async () => {
  const originalFindOne = Announcement.findOne;
  const originalExists = Announcement.exists;
  const activeItems = [
    {
      _id: 'customer-message',
      audience: 'customers',
      message: 'Customer-only update',
      startsAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + 60_000),
    },
    {
      _id: 'owner-message',
      audience: 'salon_owners',
      message: 'Owner-only update',
      startsAt: new Date(Date.now() - 30_000),
      expiresAt: new Date(Date.now() + 60_000),
    },
  ];
  const createQuery = (item) => ({
    sort() { return this; },
    lean: async () => item,
  });
  Announcement.exists = async () => activeItems.length > 0;
  Announcement.findOne = (query) => createQuery(activeItems.find((item) =>
    query.audience.$in.includes(item.audience)
  ) || null);

  const invoke = async (user) => {
    const response = createResponse();
    let forwardedError;
    await getActiveAnnouncement({ user }, response, (error) => { forwardedError = error; });
    assert.equal(forwardedError, undefined);
    return response.body;
  };

  try {
    const guest = await invoke(null);
    assert.equal(guest.hasActiveAnnouncement, true);
    assert.equal(guest.announcement, null);

    const customer = await invoke({ role: 'user' });
    assert.equal(customer.announcement.message, 'Customer-only update');

    const owner = await invoke({ role: 'owner' });
    assert.equal(owner.announcement.message, 'Owner-only update');

    const admin = await invoke({ role: 'admin' });
    assert.equal(admin.hasActiveAnnouncement, false);
    assert.equal(admin.announcement, null);

    activeItems.splice(0, activeItems.length, {
      _id: 'both-message',
      audience: 'both',
      message: 'Shared update',
      startsAt: new Date(Date.now() - 30_000),
      expiresAt: new Date(Date.now() + 60_000),
    });
    assert.equal((await invoke({ role: 'user' })).announcement.message, 'Shared update');
    assert.equal((await invoke({ role: 'owner' })).announcement.message, 'Shared update');

    activeItems.splice(0, activeItems.length, {
      _id: 'owner-only-message',
      audience: 'salon_owners',
      message: 'Owner-only update',
      startsAt: new Date(Date.now() - 30_000),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const unmatchedCustomer = await invoke({ role: 'user' });
    assert.equal(unmatchedCustomer.hasActiveAnnouncement, false);
    assert.equal(unmatchedCustomer.announcement, null);
  } finally {
    Announcement.findOne = originalFindOne;
    Announcement.exists = originalExists;
  }
});

test('admin announcement create, edit, and delete handlers persist validated messages', async () => {
  const originalCreate = Announcement.create;
  const originalUpdate = Announcement.findOneAndUpdate;
  const originalDelete = Announcement.findByIdAndDelete;
  const start = new Date(Date.now() - 60_000).toISOString();
  const end = new Date(Date.now() + 60_000).toISOString();
  const body = { audience: 'customers', message: '  Service update  ', startsAt: start, expiresAt: end };
  let created;
  let updated;
  let deleted;
  Announcement.create = async (value) => {
    created = value;
    return { id: '0123456789abcdef01234567', ...value };
  };
  Announcement.findOneAndUpdate = async (filter, value, options) => {
    updated = { filter, value, options };
    return { id: '0123456789abcdef01234567', ...value };
  };
  Announcement.findByIdAndDelete = async (id) => {
    deleted = id;
    return { id };
  };

  const invoke = async (controller, request) => {
    const response = createResponse();
    let forwardedError;
    await controller(request, response, (error) => { forwardedError = error; });
    assert.equal(forwardedError, undefined);
    return response;
  };

  try {
    const createdResponse = await invoke(createAnnouncement, { body });
    assert.equal(createdResponse.statusCode, 201);
    assert.equal(created.message, 'Service update');

    const updatedResponse = await invoke(updateAnnouncement, {
      params: { id: '0123456789abcdef01234567' },
      body: { ...body, message: 'Updated service message' },
    });
    assert.equal(updatedResponse.statusCode, 200);
    assert.equal(updated.value.message, 'Updated service message');

    const deletedResponse = await invoke(deleteAnnouncement, {
      params: { id: '0123456789abcdef01234567' },
    });
    assert.equal(deletedResponse.statusCode, 200);
    assert.equal(deletedResponse.body.message, 'Announcement deleted.');
    assert.equal(deleted, '0123456789abcdef01234567');
  } finally {
    Announcement.create = originalCreate;
    Announcement.findOneAndUpdate = originalUpdate;
    Announcement.findByIdAndDelete = originalDelete;
  }
});

test('announcements use MongoDB TTL cleanup after their expiry', () => {
  const expiryIndex = Announcement.schema.indexes().find(([fields, options]) =>
    fields.expiresAt === 1 && options.expireAfterSeconds === 0
  );
  assert.ok(expiryIndex);
});
