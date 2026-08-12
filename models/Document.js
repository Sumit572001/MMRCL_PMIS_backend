const mongoose = require('mongoose');

const TransmissionHistorySchema = new mongoose.Schema({
  fromRole: {
    type: String,
    required: true
  },
  toRole: {
    type: String,
    required: true
  },
  transactedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  transactedAt: {
    type: Date,
    default: Date.now
  },
  statusAfter: {
    type: String,
    required: true
  },
  comments: {
    type: String,
    default: ''
  }
});

const DocumentVersionSchema = new mongoose.Schema({
  revision: {
    type: String,
    required: true,
    default: '0'
  },
  filePath: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number,
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  },
  transmissionHistory: [TransmissionHistorySchema],
  hardCopiesReceived: {
    A1: { type: Number, default: 0 },
    A3: { type: Number, default: 0 },
    A4: { type: Number, default: 0 }
  },
  hardCopiesVerifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  hardCopiesVerifiedAt: {
    type: Date
  },
  reviewStatus: {
    type: String,
    enum: ['Pending', 'Approved', 'Approved with Comments', 'Comments Issued', 'Rejected'],
    default: 'Pending'
  },
  reviewerComments: {
    type: String,
    default: ''
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewedAt: {
    type: Date
  }
});

const DocumentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Please add a document title'],
    trim: true
  },
  documentNumber: {
    type: String,
    required: [true, 'Please add a unique document number'],
    unique: true,
    trim: true
  },
  submittalMatrixId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SubmittalMatrix',
    required: true
  },
  status: {
    type: String,
    enum: [
      'Draft',
      'Pending Engineer Review',
      'Engineer Reviewed - Comments Issued',
      'Transmitted to Employer',
      'Employer Approved',
      'Approved with Comments',
      'Rejected'
    ],
    default: 'Pending Engineer Review'
  },
  currentRevision: {
    type: String,
    default: '0'
  },
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  versions: [DocumentVersionSchema],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt timestamp on save
DocumentSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Document', DocumentSchema);
module.exports.DocumentVersionSchema = DocumentVersionSchema;
