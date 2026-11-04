// Runs before every test file (jest setupFiles), before src/config.js is loaded.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.BCRYPT_ROUNDS = '4'; // fast hashing; never use this low in real environments
