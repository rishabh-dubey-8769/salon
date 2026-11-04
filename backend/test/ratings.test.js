const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Rating = require('../models/rating');
const Salon = require('../models/salon');
const { getMySalonRatings, rateSalon } = require('../controllers/salonController');

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

test('salon ratings enforce one whole-star rating per customer and salon', () => {
  const indexes = Rating.schema.indexes();
  assert.ok(indexes.some(([fields, options]) =>
    fields.salonId === 1 && fields.userId === 1 && options.unique === true
  ));
  assert.equal(Rating.schema.path('value').options.min, 1);
  assert.equal(Rating.schema.path('value').options.max, 5);
});

test('a customer can rate an approved salon without a completed booking', async () => {
  const originalSalonFindOne = Salon.findOne;
  const originalRatingUpdate = Rating.findOneAndUpdate;
  const originalRatingAggregate = Rating.aggregate;
  const salonId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  let updateQuery;
  let updateValues;
  try {
    Salon.findOne = (query) => {
      assert.deepEqual(query, { _id: salonId.toString(), isApproved: true, isActive: true });
      return { select: async () => ({ _id: salonId }) };
    };
    Rating.findOneAndUpdate = async (query, update, options) => {
      updateQuery = query;
      updateValues = { update, options };
    };
    Rating.aggregate = async () => [{ average: 4, count: 2 }];

    const response = createResponse();
    await rateSalon({ params: { id: salonId.toString() }, body: { rating: 5 }, user: { id: userId } }, response, assert.fail);

    assert.deepEqual(updateQuery, { salonId, userId });
    assert.equal(updateValues.update.$set.value, 5);
    assert.equal(updateValues.options.upsert, true);
    assert.equal(updateValues.options.runValidators, true);
    assert.equal(response.body.rating, 5);
    assert.equal(response.body.average, 4);
    assert.equal(response.body.ratingCount, 2);
  } finally {
    Salon.findOne = originalSalonFindOne;
    Rating.findOneAndUpdate = originalRatingUpdate;
    Rating.aggregate = originalRatingAggregate;
  }
});

test('customer rating endpoint rejects invalid star values', async () => {
  const response = createResponse();
  await rateSalon({ params: { id: new mongoose.Types.ObjectId().toString() }, body: { rating: 5.5 }, user: { id: new mongoose.Types.ObjectId() } }, response, assert.fail);
  assert.equal(response.statusCode, 400);
});

test('customers can retrieve their own salon ratings without exposing other accounts', async () => {
  const originalFind = Rating.find;
  const userId = new mongoose.Types.ObjectId();
  const salonId = new mongoose.Types.ObjectId();
  try {
    Rating.find = (query) => {
      assert.deepEqual(query, { userId });
      return {
        select(fields) {
          assert.equal(fields, 'salonId value');
          return {
            lean: async () => [{ salonId, value: 3 }],
          };
        },
      };
    };
    const response = createResponse();
    await getMySalonRatings({ user: { id: userId } }, response, assert.fail);
    assert.deepEqual(response.body.ratings, { [salonId.toString()]: 3 });
  } finally {
    Rating.find = originalFind;
  }
});
