const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const GeneralDocument = require('../models/GeneralDocument');
const GeneralFolder = require('../models/GeneralFolder');
const { protect, authorize } = require('../middleware/auth');

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
    const section = (req.section || req.params.section || 'general').toLowerCase();
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, section + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Default folders for different sections
const defaultFoldersBySection = {
  tender: [
    '1. Corrigendum',
    '2. Work 314271'
  ]
};

// Clean up seeded folders for other sections (run once at start)
const cleanupSeededFolders = async () => {
  try {
    const result = await GeneralFolder.deleteMany({ section: { $ne: 'tender' } });
    if (result.deletedCount > 0) {
      console.log(`[Cleanup] Deleted ${result.deletedCount} pre-seeded folders for non-tender sections.`);
    }
  } catch (err) {
    console.error('[Cleanup] Failed to clean up pre-seeded folders:', err);
  }
};
cleanupSeededFolders();

// Helper to get section safely
const getSection = (req) => {
  return (req.section || req.params.section || 'general').toLowerCase();
};

// @desc    Get all folders for a section (auto seeds default list on first request)
// @route   GET /folders
// @access  Private
router.get('/folders', protect, async (req, res) => {
  try {
    const section = getSection(req);
    let folders = await GeneralFolder.find({ section }).sort({ name: 1 });
    
    // Auto seed if empty and defaults are defined
    if (folders.length === 0 && defaultFoldersBySection[section]) {
      const defaults = defaultFoldersBySection[section].map(name => ({ name, section }));
      await GeneralFolder.insertMany(defaults);
      folders = await GeneralFolder.find({ section }).sort({ name: 1 });
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

// @desc    Create new folder in a section
// @route   POST /folders
// @access  Private (All Authenticated Users)
router.post('/folders', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const { name, parentFolder } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Please provide folder name' });
    }

    const parentFolderId = parentFolder || null;

    const folderExists = await GeneralFolder.findOne({ name: name.trim(), section, parentFolder: parentFolderId });
    if (folderExists) {
      return res.status(400).json({ success: false, message: 'Folder name already exists in this parent folder' });
    }

    const folder = await GeneralFolder.create({ name: name.trim(), section, parentFolder: parentFolderId });
    res.status(201).json({
      success: true,
      data: folder
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Delete a folder and all its documents in a section
// @route   DELETE /folders/:id
// @access  Private (NECPL / Admin Only)
router.delete('/folders/:id', protect, async (req, res) => {
  try {
    const isFullRightsUser = req.user && (
      req.user.role === 'Site Engineer' ||
      (req.user.userId && req.user.userId.toUpperCase() === 'NECPL') ||
      (req.user.email && req.user.email.toLowerCase().includes('necpl'))
    );
    if (!isFullRightsUser) {
      return res.status(403).json({ success: false, message: 'Delete rights are reserved exclusively for NECPL (Admin).' });
    }

    const section = getSection(req);
    const folder = await GeneralFolder.findOne({ _id: req.params.id, section });
    if (!folder) {
      return res.status(404).json({ success: false, message: 'Folder not found in this section' });
    }

    const deleteFolderRecursive = async (folderId) => {
      // Find subfolders
      const subfolders = await GeneralFolder.find({ parentFolder: folderId, section });
      for (const sub of subfolders) {
        await deleteFolderRecursive(sub._id);
      }

      // Find documents inside this folder
      const documents = await GeneralDocument.find({ 
        $or: [
          { folder: folderId.toString() },
          { folder: folder.name }
        ],
        section 
      });

      // Delete physical files
      for (const doc of documents) {
        if (doc.filePath && fs.existsSync(doc.filePath)) {
          try {
            fs.unlinkSync(doc.filePath);
          } catch (unlinkErr) {
            console.error(`Failed to delete physical file: ${doc.filePath}`, unlinkErr);
          }
        }
        await GeneralDocument.findByIdAndDelete(doc._id);
      }

      // Delete the folder itself
      await GeneralFolder.findByIdAndDelete(folderId);
    };

    await deleteFolderRecursive(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Folder and all its subfolders/contents deleted successfully'
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Get all documents for a section
// @route   GET /
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const documents = await GeneralDocument.find({ section }).populate('uploadedBy', 'name role').sort({ uploadedAt: -1 });

    res.status(200).json({
      success: true,
      count: documents.length,
      data: documents
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Upload new document in a section
// @route   POST /
// @access  Private (All Authenticated Users)
router.post('/', protect, upload.single('file'), async (req, res) => {
  try {
    const section = getSection(req);
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload a file' });
    }

    const { name, folder } = req.body;
    if (!name || !folder) {
      return res.status(400).json({ success: false, message: 'Please provide name and folder' });
    }

     // Verify folder exists in this section
     if (folder !== 'Root') {
       const isObjectId = mongoose.isValidObjectId(folder);
       const folderExists = await GeneralFolder.findOne({
         $or: [
           ...(isObjectId ? [{ _id: folder }] : []),
           { name: folder }
         ],
         section
       });
       if (!folderExists) {
         return res.status(404).json({ success: false, message: `Folder '${folder}' not found in this section` });
       }
     }

    const document = await GeneralDocument.create({
      name,
      folder,
      section,
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

// @desc    Download document from a section
// @route   GET /download/:id
// @access  Private
router.get('/download/:id', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const document = await GeneralDocument.findOne({ _id: req.params.id, section });
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

// @desc    View document inline from a section
// @route   GET /view/:id
// @access  Private
router.get('/view/:id', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const document = await GeneralDocument.findOne({ _id: req.params.id, section });
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const resolvedPath = path.resolve(document.filePath);
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ success: false, message: 'Physical file not found on server storage' });
    }

    if (document.mimeType) {
      res.setHeader('Content-Type', document.mimeType);
    }
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(document.originalName)}"`);
    res.sendFile(resolvedPath);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Delete a document in a section
// @route   DELETE /:id
// @access  Private (NECPL / Admin Only)
router.delete('/:id', protect, async (req, res) => {
  try {
    const isFullRightsUser = req.user && (
      req.user.role === 'Site Engineer' ||
      (req.user.userId && req.user.userId.toUpperCase() === 'NECPL') ||
      (req.user.email && req.user.email.toLowerCase().includes('necpl'))
    );
    if (!isFullRightsUser) {
      return res.status(403).json({ success: false, message: 'Delete rights are reserved exclusively for NECPL (Admin).' });
    }

    const section = getSection(req);
    const document = await GeneralDocument.findOne({ _id: req.params.id, section });
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    // Delete physical file from disk
    if (document.filePath && fs.existsSync(document.filePath)) {
      try {
        fs.unlinkSync(document.filePath);
      } catch (unlinkErr) {
        console.error(`Failed to delete physical file: ${document.filePath}`, unlinkErr);
      }
    }

    await GeneralDocument.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Document deleted successfully'
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Rename a document in a section
// @route   PUT /:id
// @access  Private
router.put('/:id', protect, authorize('Site Engineer', "Employer's Office"), async (req, res) => {
  try {
    const section = getSection(req);
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Please provide a new name' });
    }

    const document = await GeneralDocument.findOneAndUpdate(
      { _id: req.params.id, section },
      { name: name.trim() },
      { new: true }
    );

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    res.status(200).json({
      success: true,
      data: document
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
