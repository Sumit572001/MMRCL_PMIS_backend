const mongoose = require('mongoose');

const ActivityLogSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: Date.now
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userName: {
    type: String,
    required: true
  },
  role: {
    type: String,
    required: true
  },
  action: {
    type: String,
    enum: ['CREATE_DOCUMENT', 'UPLOAD_VERSION', 'TRANSMIT', 'REVIEW', 'VERIFY_PAPER_COPIES', 'SHARE_LINK', 'ACCESS_SHARE'],
    required: true
  },
  document: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document'
  },
  documentNumber: {
    type: String
  },
  description: {
    type: String,
    required: true
  },
  details: {
    type: mongoose.Schema.Types.Mixed
  }
});

module.exports = mongoose.model('ActivityLog', ActivityLogSchema);
