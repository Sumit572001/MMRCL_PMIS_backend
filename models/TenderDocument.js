const mongoose = require('mongoose');

const TenderDocumentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a name/title for the document'],
    trim: true
  },
  folder: {
    type: String,
    required: true
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
  }
});

module.exports = mongoose.model('TenderDocument', TenderDocumentSchema);
