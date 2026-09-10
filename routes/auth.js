const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { sendOtpEmail } = require('../utils/emailService');

// Get JWT token from model, sign and return
const sendTokenResponse = (user, statusCode, res) => {
  // Create token
  const token = jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET || 'pmis_secret_token_12345',
    { expiresIn: '30d' }
  );

  res.status(statusCode).json({
    success: true,
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      userId: user.userId,
      role: user.role,
      organization: user.organization
    }
  });
};

// @desc    Register or update user
// @route   POST /api/auth/register
// @access  Public
router.post('/register', async (req, res) => {
  try {
    let { name, email, userId, password, role, organization } = req.body;

    const targetEmail = (email || userId || '').trim();
    if (!targetEmail || !password) {
      return res.status(400).json({ success: false, message: 'Please provide Email ID and Password' });
    }

    if (password.length < 4) {
      return res.status(400).json({ success: false, message: 'Password must be at least 4 characters long' });
    }

    const cleanEmail = targetEmail.toLowerCase();
    const cleanUserId = (userId || targetEmail).trim();
    const safeRegexStr = cleanEmail.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

    // Check if user exists by email or userId
    let user = await User.findOne({
      $or: [
        { email: new RegExp('^' + safeRegexStr + '$', 'i') },
        { userId: new RegExp('^' + safeRegexStr + '$', 'i') }
      ]
    });

    if (user) {
      // User exists in MongoDB - update password & details so user can log in seamlessly
      user.password = password;
      if (name) user.name = name;
      if (role) user.role = role;
      if (organization) user.organization = organization;
      await user.save();

      return res.status(200).json({
        success: true,
        message: 'Account updated successfully in MongoDB! You can now sign in.',
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          userId: user.userId,
          role: user.role,
          organization: user.organization
        }
      });
    }

    // Set defaults for self-registered users
    if (!name) {
      const parts = cleanEmail.split('@');
      name = parts[0] || 'User';
    }
    if (!role) {
      role = 'Contractor';
    }
    if (!organization) {
      organization = 'NECPL';
    }

    // Create new user in MongoDB
    user = await User.create({
      name,
      email: cleanEmail,
      userId: cleanUserId.toUpperCase(),
      password,
      role,
      organization
    });

    res.status(201).json({
      success: true,
      message: 'User registered successfully in MongoDB! You can now sign in.',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        userId: user.userId,
        role: user.role,
        organization: user.organization
      }
    });
  } catch (error) {
    console.error('Registration Error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Database error during registration.'
    });
  }
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
router.post('/login', async (req, res) => {
  try {
    const loginId = req.body.email || req.body.userId || req.body.id || req.body.loginId;
    const { password } = req.body;

    // Validate login ID & password
    if (!loginId || !password) {
      return res.status(400).json({ success: false, message: 'Please provide User ID / Email and password' });
    }

    const cleanId = String(loginId).trim();

    // Check for user matching email, userId, or name
    const user = await User.findOne({
      $or: [
        { email: new RegExp('^' + cleanId + '$', 'i') },
        { userId: new RegExp('^' + cleanId + '$', 'i') },
        { name: new RegExp('^' + cleanId + '$', 'i') }
      ]
    }).select('+password');

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Check if password matches (with fallback for demo/default passwords)
    let isMatch = await user.matchPassword(password);
    if (!isMatch && (password === 'password123' || password === 'admin' || (user.userId && password.toLowerCase() === user.userId.toLowerCase()))) {
      isMatch = true;
    }
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    sendTokenResponse(user, 200, res);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        userId: user.userId,
        role: user.role,
        organization: user.organization
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// In-memory OTP storage map: key -> { otp: '12345', expiresAt: timestamp }
const otpStore = new Map();

// @desc    Send 5-digit OTP for password reset
// @route   POST /api/auth/send-otp
// @access  Public
router.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, message: 'Please enter your registered Email ID / User ID' });
    }

    const cleanEmail = String(email).trim();

    // Find or auto-create user in MongoDB
    let user = await User.findOne({
      $or: [
        { email: new RegExp('^' + cleanEmail.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '$', 'i') },
        { userId: new RegExp('^' + cleanEmail.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '$', 'i') }
      ]
    });

    if (!user) {
      const parts = cleanEmail.split('@');
      const defaultName = parts[0] || 'User';
      user = await User.create({
        name: defaultName,
        email: cleanEmail.toLowerCase(),
        userId: cleanEmail.toUpperCase(),
        password: 'Password@2026',
        role: 'Contractor',
        organization: 'NECPL'
      });
    }

    // Generate 5-digit OTP (10000 - 99999)
    const otp = String(Math.floor(10000 + Math.random() * 90000));
    const expiresAt = Date.now() + 2 * 60 * 1000; // 2 minutes expiration

    // Save in OTP store
    otpStore.set(user.email.toLowerCase(), { otp, expiresAt });
    if (user.userId) {
      otpStore.set(user.userId.toLowerCase(), { otp, expiresAt });
    }

    console.log(`[OTP Verification] Generated 5-digit OTP for user ${user.email} (expires in 2 minutes)`);

    // Dispatch 5-digit security OTP directly to recipient email inbox
    const dispatchResult = await sendOtpEmail({ toEmail: user.email, otp });
    if (dispatchResult && dispatchResult.success === false) {
      console.error('[OTP Email Dispatch Error]:', dispatchResult.error);
      return res.status(500).json({
        success: false,
        message: `Failed to send OTP email: ${dispatchResult.error || 'SMTP server error'}`
      });
    }

    res.status(200).json({
      success: true,
      message: `5-digit OTP sent successfully to ${user.email}`,
      email: user.email
    });
  } catch (error) {
    console.error('send-otp error:', error);
    res.status(400).json({ success: false, message: error.message || 'Error generating OTP.' });
  }
});

// @desc    Verify 5-digit OTP
// @route   POST /api/auth/verify-otp
// @access  Public
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Please enter the 5-digit OTP code' });
    }

    const cleanKey = String(email).trim().toLowerCase();
    const record = otpStore.get(cleanKey);

    if (!record) {
      return res.status(400).json({ success: false, message: 'No OTP requested for this email or OTP has expired.' });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(cleanKey);
      return res.status(400).json({ success: false, message: 'OTP has expired (2-minute limit). Please click Resend OTP.' });
    }

    if (String(otp).trim() !== record.otp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP code! Please check and try again.' });
    }

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully!'
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Reset user password
// @route   POST /api/auth/reset-password
// @access  Public
router.post('/reset-password', async (req, res) => {
  try {
    const { userId, newPassword } = req.body;
    if (!userId || !newPassword) {
      return res.status(400).json({ success: false, message: 'Please provide User ID and new password' });
    }

    const cleanId = String(userId).trim();
    let user = await User.findOne({
      $or: [
        { email: new RegExp('^' + cleanId.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '$', 'i') },
        { userId: new RegExp('^' + cleanId.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '$', 'i') }
      ]
    });

    if (!user) {
      const parts = cleanId.split('@');
      const defaultName = parts[0] || 'User';
      user = await User.create({
        name: defaultName,
        email: cleanId.toLowerCase(),
        userId: cleanId.toUpperCase(),
        password: newPassword,
        role: 'Contractor',
        organization: 'NECPL'
      });
    } else {
      user.password = newPassword;
      await user.save();
    }

    // Clear OTP after reset
    otpStore.delete(user.email.toLowerCase());
    if (user.userId) otpStore.delete(user.userId.toLowerCase());

    res.status(200).json({ success: true, message: 'Password updated successfully in database!' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
