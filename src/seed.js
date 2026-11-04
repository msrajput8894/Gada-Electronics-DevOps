'use strict';

// Adds starter products and an admin account. Safe to run more than once.
//   npm run seed
// In production set ADMIN_EMAIL and ADMIN_PASSWORD explicitly; there is no default password there.

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('./config');
const Product = require('./models/Product');
const User = require('./models/User');

const PRODUCTS = [
  { name: 'Gada Phone X1', category: 'smartphones', price: 24999, stock: 40, description: '6.5 inch AMOLED display, 128 GB storage, 5000 mAh battery.' },
  { name: 'Gada Phone Lite', category: 'smartphones', price: 12999, stock: 60, description: 'Everyday smartphone with a 6.1 inch display and 64 GB storage.' },
  { name: 'Gada Book 14', category: 'laptops', price: 54999, stock: 15, description: '14 inch laptop, 16 GB RAM, 512 GB SSD.' },
  { name: 'Gada Book Pro 16', category: 'laptops', price: 89999, stock: 8, description: '16 inch laptop for creators, 32 GB RAM, 1 TB SSD.' },
  { name: 'Gada Buds Air', category: 'audio', price: 2999, stock: 120, description: 'True wireless earbuds with 24 hours of battery with the case.' },
  { name: 'Gada Studio Headphones', category: 'audio', price: 7999, stock: 25, description: 'Over-ear wireless headphones with active noise cancelling.' },
  { name: 'Gada Soundbar 2.1', category: 'audio', price: 8999, stock: 18, description: '2.1 channel soundbar with a wireless subwoofer.' },
  { name: 'Gada Watch S2', category: 'wearables', price: 6999, stock: 35, description: 'Smart watch with heart rate tracking and GPS.' },
  { name: 'Gada Fit Band', category: 'wearables', price: 1999, stock: 90, description: 'Slim fitness band with 14 day battery life.' },
  { name: 'Gada 4K TV 43"', category: 'televisions', price: 28999, stock: 12, description: '43 inch 4K smart TV with built-in streaming apps.' },
  { name: 'Gada Power Bank 20000', category: 'accessories', price: 1799, stock: 75, description: '20000 mAh power bank with fast charging.' },
  { name: 'Gada Fast Charger 65W', category: 'accessories', price: 1499, stock: 80, description: '65 W USB-C charger for phones and laptops.' },
];

async function seed() {
  const created = { products: 0, admin: false };

  if ((await Product.countDocuments()) === 0) {
    await Product.insertMany(PRODUCTS);
    created.products = PRODUCTS.length;
  }

  const email = (process.env.ADMIN_EMAIL || 'admin@gada.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || (config.env === 'production' ? '' : 'ChangeMe123!');
  if (!password) {
    throw new Error('Set ADMIN_PASSWORD to create the admin user in production');
  }
  if (!(await User.exists({ email }))) {
    await User.create({
      name: 'Gada Admin',
      email,
      role: 'admin',
      passwordHash: await bcrypt.hash(password, config.bcryptRounds),
    });
    created.admin = true;
  }
  return created;
}

module.exports = { seed, PRODUCTS };

if (require.main === module) {
  mongoose
    .connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 })
    .then(seed)
    .then((result) => {
      console.log('Seed complete:', result);
    })
    .catch((err) => {
      console.error('Seed failed:', err.message);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
