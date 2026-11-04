'use strict';

// All configuration comes from environment variables (12-factor style).
// The same build artifact runs in every environment; only the environment differs.

const DEV_SECRET = 'dev-only-secret-change-me';

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/gada_electronics',
  jwtSecret: process.env.JWT_SECRET || DEV_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),
  appVersion: process.env.APP_VERSION || 'dev',
};

if (config.env === 'production' && config.jwtSecret === DEV_SECRET) {
  throw new Error('JWT_SECRET must be set when NODE_ENV=production');
}

module.exports = config;
