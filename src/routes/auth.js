'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');
const { HttpError, asyncHandler } = require('../errors');
const { authenticate } = require('../middleware/auth');
const { isEmail } = require('../validate');

const router = express.Router();

const signToken = (user) =>
  jwt.sign({ role: user.role }, config.jwtSecret, {
    subject: String(user._id),
    expiresIn: config.jwtExpiresIn,
  });

const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
});

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body || {};
    const problems = [];
    if (typeof name !== 'string' || !name.trim()) problems.push('name is required');
    if (!isEmail(email)) problems.push('a valid email is required');
    if (typeof password !== 'string' || password.length < 8) {
      problems.push('password must be at least 8 characters');
    }
    if (problems.length) throw new HttpError(400, 'Validation failed', problems);

    if (await User.exists({ email: email.trim().toLowerCase() })) {
      throw new HttpError(409, 'Email already registered');
    }
    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
    // The role is never taken from the request body, so nobody can register as an admin.
    const user = await User.create({ name, email, passwordHash });
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!isEmail(email) || typeof password !== 'string') {
      throw new HttpError(400, 'email and password are required');
    }
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    // Same message for unknown email and wrong password, so accounts cannot be enumerated.
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new HttpError(401, 'Invalid email or password');
    }
    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) throw new HttpError(401, 'Account no longer exists');
    res.json({ user: publicUser(user) });
  })
);

module.exports = router;
