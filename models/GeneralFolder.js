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

// Ensure folder names are unique within the same parent folder and section
GeneralFolderSchema.index({ name: 1, section: 1, parentFolder: 1 }, { unique: true });

module.exports = mongoose.model('GeneralFolder', GeneralFolderSchema);
