const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const TenderDocument = require('../models/TenderDocument');
const TenderFolder = require('../models/TenderFolder');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// Multer storage engine configuration
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const uploadDir = process.env.UPLOAD_DIR || 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'tender-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// @desc    Get all tender folders (auto seeds default list on first request)
// @route   GET /api/tender/folders
// @access  Private
router.get('/folders', protect, async (req, res) => {
  try {
    let folders = await TenderFolder.find().sort({ name: 1 });
    
    // Auto seed if empty
    if (folders.length === 0) {
      await TenderFolder.insertMany([
        { name: '1. Corrigendum' },
        { name: '2. Work 314271' }
      ]);
      folders = await TenderFolder.find().sort({ name: 1 });
    }

    res.status(200).json({
      success: true,
      count: folders.length,
      data: folders
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Create new tender folder
// @route   POST /api/tender/folders
// @access  Private
router.post('/folders', protect, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Please provide folder name' });
    }

    const folderExists = await TenderFolder.findOne({ name: name.trim() });
    if (folderExists) {
      return res.status(400).json({ success: false, message: 'Folder name already exists' });
    }

    const folder = await TenderFolder.create({ name: name.trim() });
    res.status(201).json({
      success: true,
      data: folder
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Get all tender documents
// @route   GET /api/tender
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    // Return all uploaded documents sorted by creation date
    const documents = await TenderDocument.find().populate('uploadedBy', 'name role').sort({ uploadedAt: -1 });

    res.status(200).json({
      success: true,
      count: documents.length,
      data: documents
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Upload new tender document
// @route   POST /api/tender
// @access  Private
router.post('/', protect, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload a file' });
    }

    const { name, folder } = req.body;
    if (!name || !folder) {
      return res.status(400).json({ success: false, message: 'Please provide name and folder' });
    }

    // Verify folder exists
    const folderExists = await TenderFolder.findOne({ name: folder });
    if (!folderExists) {
      return res.status(404).json({ success: false, message: `Folder '${folder}' not found` });
    }

    const document = await TenderDocument.create({
      name,
      folder,
      filePath: req.file.path,
      originalName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      uploadedBy: req.user.id
    });

    res.status(201).json({
      success: true,
      data: document
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Download tender document
// @route   GET /api/tender/download/:id
// @access  Private
router.get('/download/:id', protect, async (req, res) => {
  try {
    const document = await TenderDocument.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const resolvedPath = path.resolve(document.filePath);
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ success: false, message: 'Physical file not found on server storage' });
    }

    res.download(resolvedPath, document.originalName);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Delete a folder and all its documents
// @route   DELETE /api/tender/folders/:id
// @access  Private
router.delete('/folders/:id', protect, async (req, res) => {
  try {
    const folder = await TenderFolder.findById(req.params.id);
    if (!folder) {
      return res.status(404).json({ success: false, message: 'Folder not found' });
    }

    // Find all documents inside this folder
    const documents = await TenderDocument.find({ folder: folder.name });

    // Delete physical files from disk
    for (const doc of documents) {
      if (doc.filePath && fs.existsSync(doc.filePath)) {
        try {
          fs.unlinkSync(doc.filePath);
        } catch (unlinkErr) {
          console.error(`Failed to delete physical file: ${doc.filePath}`, unlinkErr);
        }
      }
    }

    // Delete documents from database
    await TenderDocument.deleteMany({ folder: folder.name });

    // Delete folder from database
    await TenderFolder.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Folder and its contents deleted successfully'
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Cleanup old seeded placeholder docs if they exist
TenderDocument.deleteMany({ filePath: 'seeded-placeholder' })
  .then(res => {
    if (res.deletedCount > 0) {
      console.log(`Cleaned up ${res.deletedCount} old seeded placeholder documents.`);
    }
  })
  .catch(err => console.error('Cleanup failed:', err));

module.exports = router;
