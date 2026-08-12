const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Document = require('../models/Document');
const SubmittalMatrix = require('../models/SubmittalMatrix');
const ActivityLog = require('../models/ActivityLog');
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
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Helper for audit logging
const logActivity = async (userId, userName, role, action, docId, docNum, description, details) => {
  try {
    await ActivityLog.create({
      user: userId,
      userName,
      role,
      action,
      document: docId,
      documentNumber: docNum,
      description,
      details
    });
  } catch (err) {
    console.error('Audit log failed:', err);
  }
};

// @desc    Get all documents
// @route   GET /api/documents
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const documents = await Document.find()
      .populate('submittalMatrixId')
      .populate('creator', 'name role organization')
      .sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      count: documents.length,
      data: documents
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Get single document details
// @route   GET /api/documents/:id
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const document = await Document.findById(req.id || req.params.id)
      .populate('submittalMatrixId')
      .populate('creator', 'name role organization')
      .populate('versions.uploadedBy', 'name role organization')
      .populate('versions.hardCopiesVerifiedBy', 'name role')
      .populate('versions.reviewedBy', 'name role');

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

// @desc    Create new document & upload first version (Contractor ONLY)
// @route   POST /api/documents
// @access  Private
router.post('/', protect, authorize('Contractor'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload a file' });
    }

    const { title, documentNumber, submittalMatrixId, comments } = req.body;

    // Check if submittalMatrix exists
    const matrixItem = await SubmittalMatrix.findById(submittalMatrixId);
    if (!matrixItem) {
      return res.status(404).json({ success: false, message: 'Submittal type not found in matrix' });
    }

    // Check if document number is unique
    const numExists = await Document.findOne({ documentNumber });
    if (numExists) {
      return res.status(400).json({ success: false, message: 'Document number already exists' });
    }

    // Create the initial version item
    const initialVersion = {
      revision: '0',
      filePath: req.file.path,
      originalName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      uploadedBy: req.user.id,
      reviewStatus: 'Pending',
      reviewerComments: '',
      transmissionHistory: [
        {
          fromRole: 'Contractor',
          toRole: 'Site Engineer',
          transactedBy: req.user.id,
          statusAfter: 'Pending Engineer Review',
          comments: comments || 'Initial Electronic Submission'
        }
      ]
    };

    // Create document package
    const document = await Document.create({
      title,
      documentNumber,
      submittalMatrixId,
      status: 'Pending Engineer Review',
      currentRevision: '0',
      creator: req.user.id,
      versions: [initialVersion]
    });

    await logActivity(
      req.user.id,
      req.user.name,
      req.user.role,
      'CREATE_DOCUMENT',
      document._id,
      document.documentNumber,
      `Created document package "${title}" and uploaded Rev 0`,
      { originalName: req.file.originalname, fileSize: req.file.size }
    );

    res.status(201).json({
      success: true,
      data: document
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Upload a new version/revision of a document (Contractor ONLY)
// @route   POST /api/documents/:id/version
// @access  Private
router.post('/:id/version', protect, authorize('Contractor'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload a file' });
    }

    const document = await Document.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const { revision, comments } = req.body;
    if (!revision) {
      return res.status(400).json({ success: false, message: 'Please specify a revision label (e.g. Rev 1, Rev B)' });
    }

    // Verify revision isn't already used
    const revisionExists = document.versions.some(v => v.revision.toLowerCase() === revision.toLowerCase());
    if (revisionExists) {
      return res.status(400).json({ success: false, message: `Revision ${revision} already exists` });
    }

    const newVersion = {
      revision: revision,
      filePath: req.file.path,
      originalName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      uploadedBy: req.user.id,
      reviewStatus: 'Pending',
      transmissionHistory: [
        {
          fromRole: 'Contractor',
          toRole: 'Site Engineer',
          transactedBy: req.user.id,
          statusAfter: 'Pending Engineer Review',
          comments: comments || `Uploaded revision ${revision}`
        }
      ]
    };

    document.versions.push(newVersion);
    document.currentRevision = revision;
    document.status = 'Pending Engineer Review';
    await document.save();

    await logActivity(
      req.user.id,
      req.user.name,
      req.user.role,
      'UPLOAD_VERSION',
      document._id,
      document.documentNumber,
      `Uploaded version ${revision} of "${document.title}"`,
      { originalName: req.file.originalname, fileSize: req.file.size }
    );

    res.status(200).json({
      success: true,
      data: document
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Transmit document to next role (Engineer -> Employer, or Contractor -> Engineer)
// @route   POST /api/documents/:id/transmit
// @access  Private
router.post('/:id/transmit', protect, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const { toRole, comments } = req.body;
    if (!toRole) {
      return res.status(400).json({ success: false, message: 'Please specify the recipient role' });
    }

    let statusAfter = document.status;
    if (req.user.role === 'Site Engineer' && toRole === "Employer's Office") {
      statusAfter = 'Transmitted to Employer';
    } else if (req.user.role === 'Contractor' && toRole === 'Site Engineer') {
      statusAfter = 'Pending Engineer Review';
    } else {
      return res.status(400).json({ success: false, message: 'Invalid transmission route' });
    }

    // Add transmission log to current version
    const activeVersionIndex = document.versions.length - 1;
    if (activeVersionIndex < 0) {
      return res.status(400).json({ success: false, message: 'No versions found' });
    }

    document.versions[activeVersionIndex].transmissionHistory.push({
      fromRole: req.user.role,
      toRole,
      transactedBy: req.user.id,
      statusAfter,
      comments: comments || `Transmitted to ${toRole}`
    });

    document.status = statusAfter;
    await document.save();

    await logActivity(
      req.user.id,
      req.user.name,
      req.user.role,
      'TRANSMIT',
      document._id,
      document.documentNumber,
      `Transmitted document "${document.title}" (Rev ${document.currentRevision}) to ${toRole}`,
      { comments, statusAfter }
    );

    res.status(200).json({
      success: true,
      data: document
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Review current version (Engineer or Employer review flow)
// @route   POST /api/documents/:id/review
// @access  Private
router.post('/:id/review', protect, authorize('Site Engineer', "Employer's Office"), async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const { reviewStatus, comments } = req.body;
    if (!reviewStatus) {
      return res.status(400).json({ success: false, message: 'Please provide a review status' });
    }

    const activeVersionIndex = document.versions.length - 1;
    if (activeVersionIndex < 0) {
      return res.status(400).json({ success: false, message: 'No versions found' });
    }

    // Determine final status
    let finalDocStatus = document.status;

    if (req.user.role === 'Site Engineer') {
      if (reviewStatus === 'Comments Issued') {
        finalDocStatus = 'Engineer Reviewed - Comments Issued';
      } else if (reviewStatus === 'Approved') {
        // Can auto approved or wait for transmission to employer. 
        finalDocStatus = 'Employer Approved';
      } else if (reviewStatus === 'Rejected') {
        finalDocStatus = 'Rejected';
      }
    } else if (req.user.role === "Employer's Office") {
      if (reviewStatus === 'Approved') {
        finalDocStatus = 'Employer Approved';
      } else if (reviewStatus === 'Approved with Comments') {
        finalDocStatus = 'Approved with Comments';
      } else if (reviewStatus === 'Comments Issued') {
        finalDocStatus = 'Engineer Reviewed - Comments Issued';
      } else if (reviewStatus === 'Rejected') {
        finalDocStatus = 'Rejected';
      }
    }

    // Set reviewer data on active version
    const version = document.versions[activeVersionIndex];
    version.reviewStatus = reviewStatus;
    version.reviewerComments = comments;
    version.reviewedBy = req.user.id;
    version.reviewedAt = Date.now();

    // Log transmission details
    version.transmissionHistory.push({
      fromRole: req.user.role,
      toRole: 'Contractor',
      transactedBy: req.user.id,
      statusAfter: finalDocStatus,
      comments: `Review completed. Status: ${reviewStatus}. Comments: ${comments || 'None'}`
    });

    document.status = finalDocStatus;
    await document.save();

    await logActivity(
      req.user.id,
      req.user.name,
      req.user.role,
      'REVIEW',
      document._id,
      document.documentNumber,
      `Reviewed document "${document.title}" (Rev ${document.currentRevision}) with status "${reviewStatus}"`,
      { reviewStatus, comments }
    );

    res.status(200).json({
      success: true,
      data: document
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Verify delivered hard copies (Site Engineer ONLY)
// @route   POST /api/documents/:id/verify-paper
// @access  Private
router.post('/:id/verify-paper', protect, authorize('Site Engineer'), async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const { A1, A3, A4 } = req.body;
    if (A1 === undefined && A3 === undefined && A4 === undefined) {
      return res.status(400).json({ success: false, message: 'Please provide at least one copy type count' });
    }

    const activeVersionIndex = document.versions.length - 1;
    if (activeVersionIndex < 0) {
      return res.status(400).json({ success: false, message: 'No versions found' });
    }

    const version = document.versions[activeVersionIndex];
    if (A1 !== undefined) version.hardCopiesReceived.A1 = Number(A1);
    if (A3 !== undefined) version.hardCopiesReceived.A3 = Number(A3);
    if (A4 !== undefined) version.hardCopiesReceived.A4 = Number(A4);

    version.hardCopiesVerifiedBy = req.user.id;
    version.hardCopiesVerifiedAt = Date.now();

    await document.save();

    await logActivity(
      req.user.id,
      req.user.name,
      req.user.role,
      'VERIFY_PAPER_COPIES',
      document._id,
      document.documentNumber,
      `Verified hard copy delivery for "${document.title}" (Rev ${document.currentRevision}): A1=${version.hardCopiesReceived.A1}, A3=${version.hardCopiesReceived.A3}, A4=${version.hardCopiesReceived.A4}`,
      { hardCopies: version.hardCopiesReceived }
    );

    res.status(200).json({
      success: true,
      data: document
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Download a specific document version file
// @route   GET /api/documents/download/:versionId
// @access  Private
router.get('/download/:versionId', protect, async (req, res) => {
  try {
    const document = await Document.findOne({
      'versions._id': req.params.versionId
    });

    if (!document) {
      return res.status(404).json({ success: false, message: 'File version metadata not found' });
    }

    const versionObj = document.versions.id(req.params.versionId);
    if (!versionObj) {
      return res.status(404).json({ success: false, message: 'Version not found in document package' });
    }

    const resolvedPath = path.resolve(versionObj.filePath);
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ success: false, message: 'Physical file not found on server storage' });
    }

    res.download(resolvedPath, versionObj.originalName);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    View a specific document version file inline
// @route   GET /api/documents/view/:versionId
// @access  Private
router.get('/view/:versionId', protect, async (req, res) => {
  try {
    const document = await Document.findOne({
      'versions._id': req.params.versionId
    });

    if (!document) {
      return res.status(404).json({ success: false, message: 'File version metadata not found' });
    }

    const versionObj = document.versions.id(req.params.versionId);
    if (!versionObj) {
      return res.status(404).json({ success: false, message: 'Version not found in document package' });
    }

    const resolvedPath = path.resolve(versionObj.filePath);
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ success: false, message: 'Physical file not found on server storage' });
    }

    if (versionObj.mimeType) {
      res.setHeader('Content-Type', versionObj.mimeType);
    }
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(versionObj.originalName)}"`);
    res.sendFile(resolvedPath);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
