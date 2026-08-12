const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const Document = require('../models/Document');
const SecureShare = require('../models/SecureShare');
const ActivityLog = require('../models/ActivityLog');
const { protect } = require('../middleware/auth');

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

// @desc    Generate a secure sharing link for a document/version (Site Engineer ONLY)
// @route   POST /api/share
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    // Only Engineers can generate links for Employer Main Office as per Rule 14
    if (req.user.role !== 'Site Engineer') {
      return res.status(403).json({ success: false, message: 'Only Site Engineers can generate secure sharing links' });
    }

    const { documentId, versionId, expiresInHours, passcode } = req.body;
    if (!documentId || !versionId) {
      return res.status(400).json({ success: false, message: 'Please provide documentId and versionId' });
    }

    // Verify document exists
    const document = await Document.findById(documentId);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    // Verify version exists
    const versionObj = document.versions.id(versionId);
    if (!versionObj) {
      return res.status(404).json({ success: false, message: 'Specified document version not found' });
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');

    // Calculate expiration date
    const hours = parseInt(expiresInHours) || 24;
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + hours);

    const share = await SecureShare.create({
      token,
      document: documentId,
      versionId,
      createdBy: req.user.id,
      expiresAt,
      passcode: passcode || ''
    });

    await logActivity(
      req.user.id,
      req.user.name,
      req.user.role,
      'SHARE_LINK',
      document._id,
      document.documentNumber,
      `Generated secure share link for "${document.title}" (Rev ${versionObj.revision}) expiring in ${hours} hours`,
      { shareId: share._id, expiresAt }
    );

    res.status(201).json({
      success: true,
      data: {
        token: share.token,
        expiresAt: share.expiresAt,
        passcodeRequired: !!passcode
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Verify share token & check passcode requirements
// @route   GET /api/share/verify/:token
// @access  Public
router.get('/verify/:token', async (req, res) => {
  try {
    const share = await SecureShare.findOne({ token: req.params.token })
      .populate('document')
      .populate('createdBy', 'name organization role');

    if (!share) {
      return res.status(404).json({ success: false, message: 'Invalid or expired share link' });
    }

    // Check expiration
    if (new Date() > share.expiresAt) {
      await SecureShare.deleteOne({ _id: share._id });
      return res.status(410).json({ success: false, message: 'This secure sharing link has expired' });
    }

    const versionObj = share.document.versions.id(share.versionId);
    if (!versionObj) {
      return res.status(404).json({ success: false, message: 'Document version no longer exists' });
    }

    res.status(200).json({
      success: true,
      data: {
        documentTitle: share.document.title,
        documentNumber: share.document.documentNumber,
        revision: versionObj.revision,
        createdBy: share.createdBy.name,
        createdFrom: share.createdBy.organization,
        expiresAt: share.expiresAt,
        passcodeRequired: !!share.passcode
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Access document via secure share link (with passcode verification)
// @route   POST /api/share/access/:token
// @access  Public
router.post('/access/:token', async (req, res) => {
  try {
    const { passcode } = req.body;
    const share = await SecureShare.findOne({ token: req.params.token })
      .populate('document')
      .populate('createdBy', 'name organization');

    if (!share) {
      return res.status(404).json({ success: false, message: 'Invalid or expired share link' });
    }

    // Check expiration
    if (new Date() > share.expiresAt) {
      await SecureShare.deleteOne({ _id: share._id });
      return res.status(410).json({ success: false, message: 'This secure sharing link has expired' });
    }

    // Check passcode if required
    if (share.passcode && share.passcode !== passcode) {
      return res.status(401).json({ success: false, message: 'Incorrect passcode provided' });
    }

    const versionObj = share.document.versions.id(share.versionId);
    if (!versionObj) {
      return res.status(404).json({ success: false, message: 'Document version no longer exists' });
    }

    // Increment access count
    share.accessCount += 1;
    await share.save();

    // Log the anonymous or guest access using system record
    await ActivityLog.create({
      user: share.createdBy._id, // credited to generator for tracking
      userName: `Employer Office Guest (Via Secure Link)`,
      role: "Employer's Office",
      action: 'ACCESS_SHARE',
      document: share.document._id,
      documentNumber: share.document.documentNumber,
      description: `Secure link accessed for "${share.document.title}" (Rev ${versionObj.revision})`
    });

    res.status(200).json({
      success: true,
      data: {
        document: {
          id: share.document._id,
          title: share.document.title,
          documentNumber: share.document.documentNumber,
          currentRevision: share.document.currentRevision,
          status: share.document.status
        },
        version: {
          id: versionObj._id,
          revision: versionObj.revision,
          originalName: versionObj.originalName,
          fileSize: versionObj.fileSize,
          mimeType: versionObj.mimeType,
          uploadedAt: versionObj.uploadedAt,
          hardCopiesReceived: versionObj.hardCopiesReceived,
          reviewStatus: versionObj.reviewStatus,
          reviewerComments: versionObj.reviewerComments
        },
        downloadUrl: `/api/share/download/${share.token}?passcode=${encodeURIComponent(passcode || '')}`
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Download file via secure share link
// @route   GET /api/share/download/:token
// @access  Public
router.get('/download/:token', async (req, res) => {
  try {
    const passcode = req.query.passcode || '';
    const share = await SecureShare.findOne({ token: req.params.token }).populate('document');

    if (!share) {
      return res.status(404).json({ success: false, message: 'Invalid or expired share link' });
    }

    if (new Date() > share.expiresAt) {
      await SecureShare.deleteOne({ _id: share._id });
      return res.status(410).json({ success: false, message: 'This secure sharing link has expired' });
    }

    // Check passcode if required
    if (share.passcode && share.passcode !== passcode) {
      return res.status(401).json({ success: false, message: 'Incorrect passcode. Access Denied.' });
    }

    const versionObj = share.document.versions.id(share.versionId);
    if (!versionObj) {
      return res.status(404).json({ success: false, message: 'File version no longer exists' });
    }

    const resolvedPath = path.resolve(versionObj.filePath);
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ success: false, message: 'File not found on server storage' });
    }

    res.download(resolvedPath, versionObj.originalName);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
