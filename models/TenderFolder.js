const mongoose = require('mongoose');

const TenderFolderSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a folder name'],
    unique: true,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('TenderFolder', TenderFolderSchema);
