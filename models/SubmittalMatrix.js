const mongoose = require('mongoose');

const SubmittalMatrixSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  paperCopies: {
    A1: {
      type: Number,
      default: 0
    },
    A3: {
      type: Number,
      default: 0
    },
    A4: {
      type: Number,
      default: 0
    }
  },
  electronicCopies: {
    type: Number,
    default: 0
  },
  reference: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('SubmittalMatrix', SubmittalMatrixSchema);
