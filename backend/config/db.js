const mongoose = require('mongoose');
const Salon = require('../models/salon');
const backfillAccountUids = require('../utils/backfillAccountUids');

const sampleSalons = [
  {
    name: 'Urban Fade Studio',
    city: 'Patna',
    address: 'Boring Road, Patna',
    lat: 25.6072,
    lng: 85.1448,
    phone: '+919876543210',
    rating: 4.8,
    isOpen: true,
    isApproved: true,
    services: [
      { name: 'Hair Cut', category: 'Haircut', price: 299, durationMinutes: 30 },
      { name: 'Beard Trim', category: 'Beard', price: 199, durationMinutes: 20 },
      { name: 'Hair Color', category: 'Color', price: 699, durationMinutes: 60 },
    ],
  },
  {
    name: 'Royal Groom Lounge',
    city: 'Patna',
    address: 'Ashok Rajpath, Patna',
    lat: 25.6206,
    lng: 85.1587,
    phone: '+919876543211',
    rating: 4.9,
    isOpen: true,
    isApproved: true,
    services: [
      { name: 'Hair Cut', category: 'Haircut', price: 349, durationMinutes: 30 },
      { name: 'Beard Trim', category: 'Beard', price: 249, durationMinutes: 20 },
      { name: 'Hair Spa', category: 'Spa', price: 899, durationMinutes: 60 },
    ],
  },
  {
    name: 'The Barber House',
    city: 'Patna',
    address: 'Kankarbagh, Patna',
    lat: 25.5809,
    lng: 85.1204,
    phone: '+919876543212',
    rating: 4.6,
    isOpen: false,
    isApproved: true,
    services: [
      { name: 'Hair Cut', category: 'Haircut', price: 299, durationMinutes: 30 },
      { name: 'Shave', category: 'Beard', price: 149, durationMinutes: 20 },
      { name: 'Skin Care', category: 'Skin Care', price: 399, durationMinutes: 30 },
    ],
  },
];

const connectDB = async () => {
  const uri = process.env.DB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Set DB_URI to a MongoDB connection string before starting.');

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  await backfillAccountUids();

  if (process.env.SEED_DEMO_SALONS === 'true' && (await Salon.countDocuments()) === 0) {
    await Salon.insertMany(sampleSalons);
    console.log('Inserted sample salons. Set SEED_DEMO_SALONS=false to disable this.');
  }
  console.log('MongoDB connected.');
};

module.exports = { connectDB };
