const mongoose = require('mongoose');

const SecureShareSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true
  },
  document: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    required: true
  },
  versionId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  passcode: {
    type: String, // Plaintext or hashed passcode for simple lock
    default: ''
  },
  accessCount: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('SecureShare', SecureShareSchema);
