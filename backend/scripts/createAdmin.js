require('dotenv').config();

const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const ensureAdmin = require('../utils/ensureAdmin');

const createAdmin = async () => {
  await connectDB();
  await ensureAdmin();
};

createAdmin()
  .catch((error) => {
    console.error('Could not create admin:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
