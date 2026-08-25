const mongoose = require('mongoose');

const GeneralDocumentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a name/title for the document'],
    trim: true
  },
  folder: {
    type: String,
    required: true
  },
  section: {
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
  },
  remark: {
    type: String,
    default: ''
  },
  approvalAuthority: {
    type: String,
    default: ''
  },
  approvedBy: {
    type: String,
    default: ''
  },
  approvalStatus: {
    type: String,
    default: 'Approved'
  },
  remarks: [
    {
      text: { type: String, default: '' },
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      userName: { type: String, default: 'User' },
      userRole: { type: String, default: 'User' },
      createdAt: { type: Date, default: Date.now },
      readBy: [{ type: String }],
      attachments: [
        {
          filePath: { type: String },
          originalName: { type: String },
          fileSize: { type: Number },
          mimeType: { type: String }
        }
      ]
    }
  ],
  viewedBy: [{ type: String }],
  subDocuments: [
    {
      name: { type: String, required: true },
      originalName: { type: String, required: true },
      filePath: { type: String, required: true },
      fileSize: { type: Number, required: true },
      mimeType: { type: String, required: true },
      uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      uploadedByName: { type: String, default: 'User' },
      uploadedAt: { type: Date, default: Date.now },
      approvalAuthority: { type: String, default: '' },
      approvedBy: { type: String, default: '' },
      approvalStatus: { type: String, default: 'Approved' },
      remarks: [
        {
          text: { type: String, default: '' },
          user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          userName: { type: String, default: 'User' },
          userRole: { type: String, default: 'User' },
          createdAt: { type: Date, default: Date.now },
          readBy: [{ type: String }],
          attachments: [
            {
              filePath: { type: String },
              originalName: { type: String },
              fileSize: { type: Number },
              mimeType: { type: String }
            }
          ]
        }
      ]
    }
  ]
});

module.exports = mongoose.model('GeneralDocument', GeneralDocumentSchema);
