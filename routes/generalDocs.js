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
  destination: function (req, file, cb) {
    const uploadDir = process.env.UPLOAD_DIR || 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
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

    const currentUserId = (req.user._id || req.user.id || req.user.userId || 'user').toString();

    const document = await GeneralDocument.create({
      name,
      folder,
      section,
      filePath: req.file.path,
      originalName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      uploadedBy: req.user.id,
      viewedBy: [currentUserId]
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

// @desc    Add a new remark message to a document in a section (WhatsApp-style Chat with Attachments)
// @route   PUT /:id/remark
// @access  Private
router.put('/:id/remark', protect, upload.any(), async (req, res) => {
  try {
    const section = getSection(req);
    const text = (req.body.text || req.body.remark || '').trim();

    let uploadedFiles = [];
    if (req.files && Array.isArray(req.files)) {
      uploadedFiles = req.files;
    } else if (req.file) {
      uploadedFiles = [req.file];
    }

    if (!text && uploadedFiles.length === 0) {
      return res.status(400).json({ success: false, message: 'Please enter text or attach a file' });
    }

    const document = await GeneralDocument.findOne({ _id: req.params.id, section });
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const currentUserId = (req.user._id || req.user.id || req.user.userId || 'user').toString();

    const attachments = uploadedFiles.map(f => ({
      filePath: f.path,
      originalName: f.originalname,
      fileSize: f.size,
      mimeType: f.mimetype
    }));

    const remarkEntry = {
      text,
      user: req.user._id || req.user.id,
      userName: req.user.userId || req.user.name || 'User',
      userRole: req.user.organization || req.user.role || 'Member',
      createdAt: new Date(),
      readBy: [currentUserId],
      attachments
    };

    if (!document.remarks) {
      document.remarks = [];
    }

    document.remarks.push(remarkEntry);
    document.remark = text || (attachments.length > 0 ? `[Attachment: ${attachments[0].originalName}]` : '');

    await document.save();

    res.status(200).json({
      success: true,
      data: document
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    View/Download remark attachment
// @route   GET /remark-attachment/:filename
// @access  Private
router.get('/remark-attachment/:filename', protect, async (req, res) => {
  try {
    const uploadDir = process.env.UPLOAD_DIR || 'uploads';
    const filePath = path.join(uploadDir, path.basename(req.params.filename));
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Attachment file not found' });
    }
    res.sendFile(path.resolve(filePath));
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Upload a sub-document / revision for a parent document
// @route   POST /:id/sub-document
// @access  Private
router.post('/:id/sub-document', protect, upload.single('file'), async (req, res) => {
  try {
    const section = getSection(req);
    const document = await GeneralDocument.findOne({ _id: req.params.id, section });
    if (!document) {
      return res.status(404).json({ success: false, message: 'Parent document not found' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload a file' });
    }

    const { name } = req.body;
    const subDoc = {
      name: name || req.file.originalname,
      originalName: req.file.originalname,
      filePath: req.file.filename,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      uploadedBy: req.user._id || req.user.id,
      uploadedByName: req.user.userId || req.user.name || 'User',
      uploadedAt: new Date()
    };

    if (!document.subDocuments) {
      document.subDocuments = [];
    }

    document.subDocuments.push(subDoc);
    await document.save();

    res.status(201).json({
      success: true,
      data: document
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Rename a sub-document
// @route   PUT /:id/sub-document/:subId/rename
// @access  Private
router.put('/:id/sub-document/:subId/rename', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const document = await GeneralDocument.findOne({ _id: req.params.id, section });
    if (!document) {
      return res.status(404).json({ success: false, message: 'Parent document not found' });
    }

    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Please provide a valid name' });
    }

    const subDoc = document.subDocuments.id(req.params.subId);
    if (!subDoc) {
      return res.status(404).json({ success: false, message: 'Sub-document not found' });
    }

    subDoc.name = name.trim();
    await document.save();

    res.status(200).json({
      success: true,
      data: document
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Delete a sub-document
// @route   DELETE /:id/sub-document/:subId
// @access  Private
router.delete('/:id/sub-document/:subId', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const document = await GeneralDocument.findOne({ _id: req.params.id, section });
    if (!document) {
      return res.status(404).json({ success: false, message: 'Parent document not found' });
    }

    const subDoc = document.subDocuments.id(req.params.subId);
    if (!subDoc) {
      return res.status(404).json({ success: false, message: 'Sub-document not found' });
    }

    const uploadDir = process.env.UPLOAD_DIR || 'uploads';
    const filePath = path.join(uploadDir, path.basename(subDoc.filePath));
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error('Error removing file:', e);
      }
    }

    document.subDocuments.pull(req.params.subId);
    await document.save();

    res.status(200).json({
      success: true,
      data: document
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Add remark to sub-document
// @route   POST /:id/sub-document/:subId/remark
// @access  Private
router.post('/:id/sub-document/:subId/remark', protect, (req, res, next) => {
  // Try multipart upload, fall back gracefully for JSON
  upload.array('attachments', 5)(req, res, (err) => {
    if (err) {
      // If multer fails (e.g. content-type is JSON), continue with empty files
      req.files = [];
    }
    next();
  });
}, async (req, res) => {
  try {
    const section = getSection(req);
    const document = await GeneralDocument.findOne({ _id: req.params.id, section });
    if (!document) {
      return res.status(404).json({ success: false, message: 'Parent document not found' });
    }

    const subDoc = document.subDocuments.id(req.params.subId);
    if (!subDoc) {
      return res.status(404).json({ success: false, message: 'Sub-document not found' });
    }

    const { text } = req.body;
    const currentUserId = (req.user._id || req.user.id || req.user.userId || 'user').toString();

    const attachments = (req.files || []).map(f => ({
      filePath: f.filename,
      originalName: f.originalname,
      fileSize: f.size,
      mimeType: f.mimetype
    }));

    const remarkEntry = {
      text: text || '',
      user: req.user._id || req.user.id,
      userName: req.user.userId || req.user.name || 'User',
      userRole: req.user.organization || req.user.role || 'Member',
      createdAt: new Date(),
      readBy: [currentUserId],
      attachments
    };

    if (!subDoc.remarks) {
      subDoc.remarks = [];
    }

    subDoc.remarks.push(remarkEntry);
    await document.save();

    res.status(200).json({
      success: true,
      data: document
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Mark sub-document remarks as read
// @route   PUT /:id/sub-document/:subId/remark/read
// @access  Private
router.put('/:id/sub-document/:subId/remark/read', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const document = await GeneralDocument.findOne({ _id: req.params.id, section });
    if (!document) {
      return res.status(404).json({ success: false, message: 'Parent document not found' });
    }

    const subDoc = document.subDocuments.id(req.params.subId);
    if (!subDoc) {
      return res.status(404).json({ success: false, message: 'Sub-document not found' });
    }

    const currentUserId = (req.user._id || req.user.id || req.user.userId || 'user').toString();

    if (subDoc.remarks && subDoc.remarks.length > 0) {
      subDoc.remarks.forEach(rem => {
        if (!rem.readBy) rem.readBy = [];
        if (!rem.readBy.includes(currentUserId)) {
          rem.readBy.push(currentUserId);
        }
      });
      await document.save();
    }

    res.status(200).json({
      success: true,
      data: document
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Clear all remarks for a sub-document
// @route   DELETE /:id/sub-document/:subId/remarks/clear-all
// @access  Private
router.delete('/:id/sub-document/:subId/remarks/clear-all', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const document = await GeneralDocument.findOne({ _id: req.params.id, section });
    if (!document) {
      return res.status(404).json({ success: false, message: 'Parent document not found' });
    }

    const subDoc = document.subDocuments.id(req.params.subId);
    if (!subDoc) {
      return res.status(404).json({ success: false, message: 'Sub-document not found' });
    }

    subDoc.remarks = [];
    await document.save();

    res.status(200).json({
      success: true,
      data: document
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Mark all remarks as read for current user
// @route   PUT /:id/remark/read
// @access  Private
router.put('/:id/remark/read', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const document = await GeneralDocument.findOne({ _id: req.params.id, section });
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const currentUserId = (req.user._id || req.user.id || req.user.userId || 'user').toString();

    let updated = false;
    if (document.remarks && document.remarks.length > 0) {
      document.remarks.forEach(rem => {
        if (!rem.readBy) rem.readBy = [];
        if (!rem.readBy.includes(currentUserId)) {
          rem.readBy.push(currentUserId);
          updated = true;
        }
      });
    }

    if (updated) {
      await document.save();
    }

    res.status(200).json({
      success: true,
      data: document
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Delete a remark message from a document
// @route   DELETE /:id/remark/:remarkId
// @access  Private
router.delete('/:id/remark/:remarkId', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const document = await GeneralDocument.findOne({ _id: req.params.id, section });
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    if (document.remarks && document.remarks.length > 0) {
      document.remarks = document.remarks.filter(rem => rem._id.toString() !== req.params.remarkId);
      const lastRem = document.remarks[document.remarks.length - 1];
      document.remark = lastRem ? lastRem.text : '';
      await document.save();
    }

    res.status(200).json({
      success: true,
      data: document
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Global baseline timestamp for notifications: Only documents uploaded after this feature timestamp show up in new upload notifications panel
const notificationBaseline = new Date('2026-08-20T16:50:00.000Z');

// @desc    Get all recently uploaded documents across all sections for notifications
// @route   GET /all-uploads
// @access  Private
router.get('/all-uploads', protect, async (req, res) => {
  try {
    const documents = await GeneralDocument.find({
      uploadedAt: { $gte: notificationBaseline }
    })
      .populate('uploadedBy', 'name role')
      .sort({ uploadedAt: -1 })
      .limit(50)
      .lean();

    // Map folder ObjectId to human-readable folder name
    const folderIds = documents
      .map(d => d.folder)
      .filter(f => f && f !== 'Root' && mongoose.isValidObjectId(f));

    const folders = await GeneralFolder.find({ _id: { $in: folderIds } }).select('_id name');
    const folderMap = {};
    folders.forEach(f => {
      folderMap[f._id.toString()] = f.name;
    });

    const data = documents.map(d => ({
      ...d,
      folderName: folderMap[d.folder] || d.folder
    }));

    res.status(200).json({
      success: true,
      count: data.length,
      data
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Mark a document as viewed by current user
// @route   PUT /:id/viewed
// @access  Private
router.put('/:id/viewed', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const document = await GeneralDocument.findOne({ _id: req.params.id, section });
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const currentUserId = (req.user._id || req.user.id || req.user.userId || 'user').toString();

    if (!document.viewedBy) {
      document.viewedBy = [];
    }

    if (!document.viewedBy.includes(currentUserId)) {
      document.viewedBy.push(currentUserId);
      await document.save();
    }

    res.status(200).json({
      success: true,
      data: document
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Clear / Mark all notifications as read for current user
// @route   PUT /mark-all-read
// @access  Private
router.put('/mark-all-read', protect, async (req, res) => {
  try {
    const currentUserId = (req.user._id || req.user.id || req.user.userId || 'user').toString();
    await GeneralDocument.updateMany(
      { viewedBy: { $ne: currentUserId } },
      { $addToSet: { viewedBy: currentUserId } }
    );
    res.status(200).json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Clear all remarks from a specific document
// @route   DELETE /:id/remarks/clear-all
// @access  Private
router.delete('/:id/remarks/clear-all', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const document = await GeneralDocument.findOneAndUpdate(
      { _id: req.params.id, section },
      { $set: { remarks: [], remark: '' } },
      { new: true }
    );
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }
    res.status(200).json({ success: true, data: document });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Reset all remarks for all documents in DB
// @route   PUT /reset-all-remarks
// @access  Private
router.put('/reset-all-remarks', protect, async (req, res) => {
  try {
    await GeneralDocument.updateMany({}, { $set: { remarks: [], remark: '' } });
    res.status(200).json({ success: true, message: 'All test remarks cleared successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
