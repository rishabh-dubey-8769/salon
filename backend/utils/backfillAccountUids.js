const User = require('../models/user');
const { generateAccountUid } = require('./accountUid');

const backfillAccountUids = async () => {
  await User.init();
  await User.collection.createIndex({ uid: 1 }, { unique: true, sparse: true, name: 'uid_1' });
  const cursor = User.find({
    role: { $in: ['user', 'owner'] },
    $or: [{ uid: { $exists: false } }, { uid: null }, { uid: '' }],
  }).select('_id role').lean().cursor({ batchSize: 500 });
  let batch = [];

  const writeBatch = async (accounts) => {
    if (!accounts.length) return;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await User.collection.bulkWrite(accounts.map((account) => ({
          updateOne: {
            filter: {
              _id: account._id,
              $or: [{ uid: { $exists: false } }, { uid: null }, { uid: '' }],
            },
            update: { $set: { uid: generateAccountUid(account.role) } },
          },
        })), { ordered: true });
        return;
      } catch (error) {
        if (error.code !== 11000 || attempt === 4) throw error;
      }
    }
  };

  for await (const account of cursor) {
    batch.push(account);
    if (batch.length === 500) {
      await writeBatch(batch);
      batch = [];
    }
  }
  await writeBatch(batch);
};

module.exports = backfillAccountUids;
