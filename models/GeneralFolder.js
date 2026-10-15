const mongoose = require('mongoose');

const GeneralFolderSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a folder name'],
    trim: true
  },
  section: {
    type: String,
    required: true
  },
  category: {
    type: String,
    default: null
  },
  parentFolder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GeneralFolder',
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('GeneralFolder', GeneralFolderSchema);
