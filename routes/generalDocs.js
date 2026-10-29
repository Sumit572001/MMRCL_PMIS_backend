const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const GeneralDocument = require('../models/GeneralDocument');
const GeneralFolder = require('../models/GeneralFolder');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');
const { notifyNewDocumentUpload } = require('../utils/emailService');

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
    const rawSection = (req.section || req.params.section || 'general').toLowerCase();
    const safeSection = rawSection.replace(/[^a-zA-Z0-9_-]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, safeSection + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage
});

// Helper to safely find physical file on disk from relative, absolute, or storage paths
function findPhysicalFile(filePathOrName, originalName) {
  if (!filePathOrName && !originalName) return null;
  const uploadDir = process.env.UPLOAD_DIR || 'uploads';
  const candidates = [];

  if (filePathOrName && typeof filePathOrName === 'string') {
    const raw = filePathOrName.trim();
    candidates.push(path.resolve(raw));
    candidates.push(path.resolve(path.join(__dirname, '..', raw)));
    candidates.push(path.resolve(path.join(__dirname, '..', uploadDir, path.basename(raw))));
    candidates.push(path.resolve(path.join(__dirname, '..', uploadDir, raw)));
    try {
      const decoded = decodeURIComponent(raw);
      if (decoded !== raw) {
        candidates.push(path.resolve(decoded));
        candidates.push(path.resolve(path.join(__dirname, '..', decoded)));
        candidates.push(path.resolve(path.join(__dirname, '..', uploadDir, path.basename(decoded))));
      }
    } catch (e) {}
  }

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        const stat = fs.statSync(c);
        if (stat.isFile()) return c;
      }
    } catch (e) {}
  }

  // Fallback: search upload directory for originalName
  if (originalName && typeof originalName === 'string') {
    try {
      const dirPath = path.resolve(path.join(__dirname, '..', uploadDir));
      if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath);
        const exactMatch = files.find(f => f.toLowerCase() === originalName.toLowerCase());
        if (exactMatch) return path.join(dirPath, exactMatch);

        const suffixMatch = files.find(f => f.toLowerCase().endsWith(originalName.toLowerCase()));
        if (suffixMatch) return path.join(dirPath, suffixMatch);
      }
    } catch (e) {}
  }

  return null;
}


const mepCategories = [
  '1. Operation and Maintenance Manuals',
  '2. E & M Submissions'
];

const monitorCategories = [
  '1. Initial Program and Works Program plus supporting information and narrative',
  '2. Monthly Program Update',
  '3. Three Month Rolling Program',
  '4. Three Week Rolling Program',
  '5. Monthly Progress Report',
  '6. Method Statements',
  '7. Interface Management Plan',
  '8. Monitoring, protection and replacement proposal reports.'
];

// Default folders for different sections
const defaultFoldersBySection = {
  tender: [
    '1. Corrigendum',
    '2. Work 314271'
  ],
  monitor: monitorCategories,
  'project monitoring & control': monitorCategories,
  drawing: [
    '1. Works Drawings',
    '2. As built drawings',
    '3. Construction Reference Drawings'
  ],
  quality: [
    '1. Quality Plan',
    '2. Quality Control Register',
    '3. Reports of Quarterly Quality Audits',
    '4. Materials Submissions (documentation)',
    '5. Materials and Workmanship Test Results/Reports'
  ],
  ehs: [
    '1. Safety Plan',
    '2. Environment Plan'
  ],
  mep: mepCategories,
  'mep & it': mepCategories,
  registrations: [
    '1. Minutes of Meeting',
    '2. Letter Correspondence',
    '3. All other submittals'
  ]
};

// Helper to get section safely

// Safely populate uploadedBy and subDocuments.uploadedBy across documents without throwing CastError on string IDs
async function populateDocumentUploaders(documents) {
  if (!documents) return documents;
  const isArray = Array.isArray(documents);
  const docsList = isArray ? documents : [documents];
  if (docsList.length === 0) return documents;

  const userIds = new Set();
  const hex24Regex = /^[0-9a-fA-F]{24}$/;

  docsList.forEach(doc => {
    if (doc.uploadedBy) {
      const uId = (doc.uploadedBy._id || doc.uploadedBy).toString();
      if (hex24Regex.test(uId)) userIds.add(uId);
    }
    if (Array.isArray(doc.subDocuments)) {
      doc.subDocuments.forEach(sd => {
        if (sd.uploadedBy) {
          const sdId = (sd.uploadedBy._id || sd.uploadedBy).toString();
          if (hex24Regex.test(sdId)) userIds.add(sdId);
        }
      });
    }
  });

  let userMap = {};
  if (userIds.size > 0) {
    const users = await User.find({ _id: { $in: Array.from(userIds) } }, 'name email userId role organization').lean();
    users.forEach(u => {
      userMap[u._id.toString()] = u;
    });
  }

  docsList.forEach(doc => {
    if (doc.uploadedBy) {
      const uIdStr = (doc.uploadedBy._id || doc.uploadedBy).toString();
      if (userMap[uIdStr]) {
        const u = userMap[uIdStr];
        doc.uploadedBy = {
          _id: u._id,
          name: u.name,
          email: u.email,
          userId: u.userId,
          role: u.role,
          organization: u.organization
        };
        doc.uploadedByName = u.name || u.userId || 'User';
      } else if (typeof doc.uploadedBy === 'string' && !hex24Regex.test(doc.uploadedBy)) {
        doc.uploadedByName = doc.uploadedByName || doc.uploadedBy;
      }
    }
    if (!doc.uploadedByName && typeof doc.uploadedBy === 'object' && doc.uploadedBy?.name) {
      doc.uploadedByName = doc.uploadedBy.name;
    }

    if (Array.isArray(doc.subDocuments)) {
      doc.subDocuments.forEach(sd => {
        if (sd.uploadedBy) {
          const sdIdStr = (sd.uploadedBy._id || sd.uploadedBy).toString();
          if (userMap[sdIdStr]) {
            const u = userMap[sdIdStr];
            sd.uploadedBy = {
              _id: u._id,
              name: u.name,
              email: u.email,
              userId: u.userId,
              role: u.role,
              organization: u.organization
            };
            sd.uploadedByName = u.name || u.userId || 'User';
          } else if (typeof sd.uploadedBy === 'string' && !hex24Regex.test(sd.uploadedBy)) {
            sd.uploadedByName = sd.uploadedByName || sd.uploadedBy;
          }
        }
        if (!sd.uploadedByName && typeof sd.uploadedBy === 'object' && sd.uploadedBy?.name) {
          sd.uploadedByName = sd.uploadedBy.name;
        }
      });
    }
  });

  return isArray ? docsList : docsList[0];
}

const getSection = (req) => {
  const raw = (req.section || req.params.section || 'general').toLowerCase();
  if (raw.includes('monitor')) return 'monitor';
  if (raw.includes('drawing')) return 'drawing';
  if (raw.includes('quality')) return 'quality';
  if (raw.includes('ehs') || raw.includes('safety')) return 'ehs';
  if (raw.includes('mep')) return 'mep';
  if (raw.includes('registration')) return 'registrations';
  if (raw.includes('ncr') || raw.includes('conformance')) return 'ncr';
  return raw;
};

const getSectionFilter = (req) => {
  const raw = (req.section || req.params.section || 'general').toLowerCase();
  const normalized = getSection(req);
  return {
    $or: [
      { section: normalized },
      { section: raw },
      { section: new RegExp(normalized, 'i') }
    ]
  };
};

// @desc    Get all folders for a section (auto seeds default category folders on request)
// @route   GET /folders
// @access  Private
router.get('/folders', protect, async (req, res) => {
  try {
    const rawSection = (req.section || req.params.section || 'general').toLowerCase();
    const section = getSection(req);

    // Find folders matching either normalized section key ('monitor') or raw section name ('project monitoring & control')
    let folders = await GeneralFolder.find({
      $or: [
        { section: section },
        { section: rawSection }
      ]
    }).sort({ name: 1 });

    // Auto seed missing default category folders if defaults are defined for this section
    const defaults = defaultFoldersBySection[section] || defaultFoldersBySection[rawSection];
    if (defaults) {
      const existingNames = new Set(folders.map(f => f.name.trim().toLowerCase()));
      const missingDefaults = defaults.filter(name => {
        const lowerName = name.trim().toLowerCase();
        const unnumbered = lowerName.replace(/^\d+\.\s*/, '');
        return !existingNames.has(lowerName) && !existingNames.has(unnumbered);
      });

      if (missingDefaults.length > 0) {
        for (const folderName of missingDefaults) {
          try {
            await GeneralFolder.create({
              name: folderName,
              section: section,
              parentFolder: null
            });
          } catch (dupErr) {
            // Ignore duplicate key errors if folder already exists in DB
          }
        }
        folders = await GeneralFolder.find({
          $or: [
            { section: section },
            { section: rawSection }
          ]
        }).sort({ name: 1 });
      }
    }

    // Sort folders: default category folders first in order, custom/new folders at the bottom
    const secDefaults = defaultFoldersBySection[section] || defaultFoldersBySection[rawSection] || [];
    const cleanDefaults = secDefaults.map(d => d.trim().toLowerCase().replace(/^\d+\.\s*/, ''));

    folders.sort((a, b) => {
      const nameA = (a.name || '').trim().toLowerCase();
      const unnumberedA = nameA.replace(/^\d+\.\s*/, '');

      const nameB = (b.name || '').trim().toLowerCase();
      const unnumberedB = nameB.replace(/^\d+\.\s*/, '');

      let indexA = cleanDefaults.findIndex(d => nameA.includes(d) || unnumberedA.includes(d) || d.includes(unnumberedA));
      let indexB = cleanDefaults.findIndex(d => nameB.includes(d) || unnumberedB.includes(d) || d.includes(unnumberedB));

      const rankA = indexA !== -1 ? indexA + 1 : 1000;
      const rankB = indexB !== -1 ? indexB + 1 : 1000;

      if (rankA !== rankB) return rankA - rankB;

      // Custom folders are sorted by creation time ascending (oldest first, newly created appended at bottom)
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : (a._id ? parseInt(a._id.toString().substring(0, 8), 16) : 0);
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : (b._id ? parseInt(b._id.toString().substring(0, 8), 16) : 0);
      if (timeA !== timeB) return timeA - timeB;

      return nameA.localeCompare(nameB);
    });

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
    const { name, parentFolder, category } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Please provide folder name' });
    }

    const parentFolderId = (parentFolder && parentFolder !== 'Root' && mongoose.isValidObjectId(parentFolder)) ? parentFolder : null;

    const folderQuery = { name: name.trim(), section, parentFolder: parentFolderId };
    if (category) folderQuery.category = category;
    const folderExists = await GeneralFolder.findOne(folderQuery);
    if (folderExists) {
      return res.status(400).json({ success: false, message: 'Folder name already exists in this parent folder' });
    }

    const folder = await GeneralFolder.create({ name: name.trim(), section, parentFolder: parentFolderId, category: category || null });
    res.status(201).json({
      success: true,
      data: folder
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Rename a folder in a section
// @route   PUT /folders/:id
// @access  Private
router.put('/folders/:id', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Please provide folder name' });
    }

    const folder = await GeneralFolder.findOne({ _id: req.params.id, section });
    if (!folder) {
      return res.status(404).json({ success: false, message: 'Folder not found in this section' });
    }

    const newName = name.trim();
    const existing = await GeneralFolder.findOne({
      name: newName,
      section,
      parentFolder: folder.parentFolder,
      _id: { $ne: folder._id }
    });
    if (existing) {
      return res.status(400).json({ success: false, message: 'A folder with this name already exists in this location' });
    }

    const oldName = folder.name;
    folder.name = newName;
    await folder.save();

    // Update any documents referencing this folder by string name
    await GeneralDocument.updateMany(
      { folder: oldName, section },
      { folder: newName }
    );

    res.status(200).json({
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
      (req.user.email && req.user.email.toLowerCase().includes('necpl')) ||
      (req.user.email && req.user.email.toLowerCase() === 'coordination.mmrcl@nyatigroup.com') ||
      (req.user.email && req.user.email.toLowerCase().includes('coordination.mmrcl')) ||
      (req.user.userId && req.user.userId.toLowerCase().includes('coordination.mmrcl')) ||
      (req.user.name && req.user.name.toLowerCase().includes('coordination.mmrcl')) ||
      section === 'registrations'
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
    const rawSection = (req.section || req.params.section || 'general').toLowerCase();
    const section = getSection(req);
    let documents = await GeneralDocument.find({
      $or: [
        { section: section },
        { section: rawSection },
        { section: new RegExp(section, 'i') }
      ]
    }).sort({ uploadedAt: -1 }).lean();

    documents = await populateDocumentUploaders(documents);

    res.status(200).json({
      success: true,
      count: documents.length,
      data: documents
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Get single document by ID across any section
// @route   GET /doc-by-id/:id
// @access  Private
router.get('/doc-by-id/:id', protect, async (req, res) => {
  try {
    let document = await GeneralDocument.findById(req.params.id).lean();
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }
    document = await populateDocumentUploaders(document);
    res.status(200).json({
      success: true,
      data: document
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
    const rawSection = (req.section || req.params.section || 'general').toLowerCase();
    const section = getSection(req);
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload a file' });
    }

    const { name, folder, category } = req.body;
    if (!name || !folder) {
      return res.status(400).json({ success: false, message: 'Please provide name and folder' });
    }

    let finalFolder = folder;
    let folderExists = null;

    // Resolve category if folder is Root
    if (finalFolder === 'Root' && category && category !== 'Overall Project' && category !== '-') {
      const cleanCat = category.replace(/^\d+\.\s*/, '').trim();
      const catFolder = await GeneralFolder.findOne({
        $and: [
          {
            $or: [
              { name: category },
              { name: new RegExp(`^(\\d+\\.\\s*)?${cleanCat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
            ]
          },
          {
            $or: [
              { section: section },
              { section: rawSection },
              { section: new RegExp(section, 'i') }
            ]
          }
        ]
      });
      if (catFolder) {
        finalFolder = catFolder._id.toString();
        folderExists = catFolder;
      }
    }

    if (finalFolder !== 'Root') {
      const isObjectId = mongoose.isValidObjectId(finalFolder);
      const unnumbered = finalFolder.replace(/^\d+\.\s*/, '').trim();

      // 1. Try finding by ObjectId directly
      if (isObjectId) {
        folderExists = await GeneralFolder.findById(finalFolder);
      }

      // 2. If not found, try matching by name or unnumbered name in this section (normalized or raw)
      if (!folderExists) {
        folderExists = await GeneralFolder.findOne({
          $and: [
            {
              $or: [
                { name: finalFolder },
                { name: new RegExp(`^(\\d+\\.\\s*)?${unnumbered.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
              ]
            },
            {
              $or: [
                { section: section },
                { section: rawSection },
                { section: new RegExp(section, 'i') }
              ]
            }
          ]
        });
      }

      // 3. If still not found, search globally by name or unnumbered name
      if (!folderExists) {
        folderExists = await GeneralFolder.findOne({
          $or: [
            { name: finalFolder },
            { name: new RegExp(`^(\\d+\\.\\s*)?${unnumbered.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
          ]
        });
      }

      // 4. If folder truly does not exist in DB, create it automatically so upload NEVER fails with 404!
      if (!folderExists) {
        try {
          folderExists = await GeneralFolder.create({
            name: finalFolder,
            section: section,
            parentFolder: null
          });
        } catch (createErr) {
          folderExists = await GeneralFolder.findOne({ name: finalFolder });
        }
      }

      if (folderExists) {
        finalFolder = folderExists._id.toString();
      }
    }

    const currentUserId = (req.user._id || req.user.id || req.user.userId || 'user').toString();

    const isNcrSection = section === 'ncr';
    const document = await GeneralDocument.create({
      name,
      folder: finalFolder,
      section,
      category: category || '-',
      filePath: req.file.path,
      originalName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      uploadedBy: req.user._id || req.user.id,
      uploadedByName: req.user.name || req.user.userId || 'User',
      viewedBy: [currentUserId],
      ...(isNcrSection ? {
        ncStatus: 'NC Pending',
        approvalStatus: 'NC Pending',
        approvalAuthority: 'PMC',
        ncRequested: false,
        ncApprovedCompliance: false
      } : {})
    });

    // Trigger non-blocking async Email Notification to all 14 users
    notifyNewDocumentUpload({
      uploaderName: req.user.name || req.user.userId || 'PMIS User',
      docName: name,
      sectionName: section,
      folderName: folderExists ? folderExists.name : (finalFolder === 'Root' ? 'Root Folder' : folder),
      originalFileName: req.file.originalname,
      uploadedAt: document.uploadedAt,
      docId: document._id.toString(),
      docType: 'general'
    }).catch(err => console.error('[EmailTrigger Error]', err));

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
    const document = await GeneralDocument.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const resolvedPath = findPhysicalFile(document.filePath || document.fileName || document.filename, document.originalName || document.fileName || document.title);
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      return res.status(404).json({ success: false, message: 'Physical file not found on server storage' });
    }

    res.download(resolvedPath, document.originalName || document.fileName || path.basename(resolvedPath));
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
    const document = await GeneralDocument.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    let resolvedPath = path.resolve(document.filePath);
    if (!fs.existsSync(resolvedPath)) {
      resolvedPath = path.resolve(path.join(__dirname, '..', document.filePath));
    }
    const uploadDir = process.env.UPLOAD_DIR || 'uploads';
    if (!fs.existsSync(resolvedPath)) {
      resolvedPath = path.resolve(path.join(__dirname, '..', uploadDir, path.basename(document.filePath)));
    }
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
// @access  Private (NECPL / Admin / Uploader)
router.delete('/:id', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const document = await GeneralDocument.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const isUploader = document.uploadedBy && req.user && (
      document.uploadedBy.toString() === (req.user._id || req.user.id || '').toString()
    );

    const isFullRightsUser = req.user && (
      req.user.role === 'Site Engineer' ||
      (req.user.userId && req.user.userId.toUpperCase() === 'NECPL') ||
      (req.user.email && req.user.email.toLowerCase().includes('necpl')) ||
      (req.user.email && req.user.email.toLowerCase() === 'coordination.mmrcl@nyatigroup.com') ||
      (req.user.email && req.user.email.toLowerCase().includes('coordination.mmrcl')) ||
      (req.user.userId && req.user.userId.toLowerCase().includes('coordination.mmrcl')) ||
      (req.user.name && req.user.name.toLowerCase().includes('coordination.mmrcl')) ||
      section === 'registrations' ||
      isUploader
    );
    if (!isFullRightsUser) {
      return res.status(403).json({ success: false, message: 'Delete rights are reserved exclusively for NECPL (Admin).' });
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

// @desc    Rename or Move a document in a section
// @route   PUT /:id
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const { name, folder, category } = req.body;

    let updateFields = {};
    if (name) updateFields.name = name.trim();
    if (folder !== undefined) updateFields.folder = folder;
    if (category !== undefined) updateFields.category = category;
    if (req.body.ncStatus !== undefined) updateFields.ncStatus = req.body.ncStatus;
    if (req.body.ncRequested !== undefined) updateFields.ncRequested = req.body.ncRequested;
    if (req.body.ncRequestedBy !== undefined) updateFields.ncRequestedBy = req.body.ncRequestedBy;
    if (req.body.ncRequestedAt !== undefined) updateFields.ncRequestedAt = req.body.ncRequestedAt;
    if (req.body.ncApprovedCompliance !== undefined) updateFields.ncApprovedCompliance = req.body.ncApprovedCompliance;
    if (req.body.ncApprovedBy !== undefined) updateFields.ncApprovedBy = req.body.ncApprovedBy;
    if (req.body.ncApprovedAt !== undefined) updateFields.ncApprovedAt = req.body.ncApprovedAt;

    const document = await GeneralDocument.findByIdAndUpdate(req.params.id,
      updateFields,
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

    const document = await GeneralDocument.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const currentUserId = (req.user._id || req.user.id || req.user.userId || 'user').toString();

    const attachments = uploadedFiles.map(f => ({
      filename: f.filename || path.basename(f.path),
      filePath: f.path || f.filename,
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
    const rawFilename = req.params.filename || '';
    let decodedFilename = rawFilename;
    try {
      decodedFilename = decodeURIComponent(rawFilename);
    } catch (e) {}
    const requestedOriginalName = req.query.originalName ? decodeURIComponent(req.query.originalName) : '';

    let resolvedPath = findPhysicalFile(rawFilename, requestedOriginalName);
    if (!resolvedPath && rawFilename !== decodedFilename) {
      resolvedPath = findPhysicalFile(decodedFilename, requestedOriginalName);
    }

    // Fallback: If not found on disk directly, query MongoDB for this attachment
    if (!resolvedPath) {
      const searchTerms = [
        rawFilename,
        decodedFilename,
        path.basename(rawFilename),
        path.basename(decodedFilename)
      ];
      if (requestedOriginalName) searchTerms.push(requestedOriginalName);

      const docMatch = await GeneralDocument.findOne({
        $or: [
          { 'remarks.attachments.filePath': { $in: searchTerms } },
          { 'remarks.attachments.filename': { $in: searchTerms } },
          { 'remarks.attachments.originalName': { $in: searchTerms } },
          { 'subDocuments.remarks.attachments.filePath': { $in: searchTerms } },
          { 'subDocuments.remarks.attachments.filename': { $in: searchTerms } },
          { 'subDocuments.remarks.attachments.originalName': { $in: searchTerms } }
        ]
      }).lean();

      if (docMatch) {
        let matchedAtt = null;
        for (const r of (docMatch.remarks || [])) {
          for (const a of (r.attachments || [])) {
            if (searchTerms.some(term => term && (a.filePath === term || a.filename === term || a.originalName === term || path.basename(a.filePath || '') === term))) {
              matchedAtt = a;
              break;
            }
          }
          if (matchedAtt) break;
        }
        if (!matchedAtt && docMatch.subDocuments) {
          for (const s of docMatch.subDocuments) {
            for (const r of (s.remarks || [])) {
              for (const a of (r.attachments || [])) {
                if (searchTerms.some(term => term && (a.filePath === term || a.filename === term || a.originalName === term || path.basename(a.filePath || '') === term))) {
                  matchedAtt = a;
                  break;
                }
              }
              if (matchedAtt) break;
            }
            if (matchedAtt) break;
          }
        }

        if (matchedAtt) {
          resolvedPath = findPhysicalFile(matchedAtt.filePath || matchedAtt.filename, matchedAtt.originalName);
        }
      }
    }

    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      return res.status(404).json({ success: false, message: 'Attachment file not found' });
    }

    const downloadName = requestedOriginalName || path.basename(resolvedPath);
    if (req.query.download === 'true') {
      return res.download(resolvedPath, downloadName);
    }
    return res.sendFile(path.resolve(resolvedPath));
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
    const document = await GeneralDocument.findById(req.params.id);
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

    // Trigger non-blocking async Email Notification for sub-document revision
    notifyNewDocumentUpload({
      uploaderName: req.user.name || req.user.userId || 'PMIS User',
      docName: `${document.name} (Revision: ${subDoc.name})`,
      sectionName: section,
      folderName: document.folder || 'Sub-Document',
      originalFileName: req.file.originalname,
      uploadedAt: subDoc.uploadedAt,
      docId: document._id.toString(),
      docType: 'general'
    }).catch(err => console.error('[EmailTrigger Error]', err));

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
    const document = await GeneralDocument.findById(req.params.id);
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
    const document = await GeneralDocument.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Parent document not found' });
    }

    const subDoc = document.subDocuments.id(req.params.subId);
    if (!subDoc) {
      return res.status(404).json({ success: false, message: 'Sub-document not found' });
    }

    const uploadDir = process.env.UPLOAD_DIR || 'uploads';
    const targetFile = subDoc.filePath || subDoc.filename;
    if (targetFile && typeof targetFile === 'string') {
      const filePath = path.join(uploadDir, path.basename(targetFile));
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.error('Error removing file:', e);
        }
      }
    }

    const updatedDocument = await GeneralDocument.findByIdAndUpdate(
      req.params.id,
      { $pull: { subDocuments: { _id: req.params.subId } } },
      { new: true }
    );

    res.status(200).json({
      success: true,
      data: updatedDocument || document
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
    const rawSection = (req.section || req.params.section || 'general').toLowerCase();
    const section = getSection(req);
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload a file' });
    }

    const { name, folder, category } = req.body;
    if (!name || !folder) {
      return res.status(400).json({ success: false, message: 'Please provide name and folder' });
    }

    let finalFolder = folder;
    let folderExists = null;

    // Resolve category if folder is Root
    if (finalFolder === 'Root' && category && category !== 'Overall Project' && category !== '-') {
      const cleanCat = category.replace(/^\d+\.\s*/, '').trim();
      const catFolder = await GeneralFolder.findOne({
        $and: [
          {
            $or: [
              { name: category },
              { name: new RegExp(`^(\\d+\\.\\s*)?${cleanCat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
            ]
          },
          {
            $or: [
              { section: section },
              { section: rawSection },
              { section: new RegExp(section, 'i') }
            ]
          }
        ]
      });
      if (catFolder) {
        finalFolder = catFolder._id.toString();
        folderExists = catFolder;
      }
    }

    if (finalFolder !== 'Root') {
      const isObjectId = mongoose.isValidObjectId(finalFolder);
      const unnumbered = finalFolder.replace(/^\d+\.\s*/, '').trim();

      // 1. Try finding by ObjectId directly
      if (isObjectId) {
        folderExists = await GeneralFolder.findById(finalFolder);
      }

      // 2. If not found, try matching by name or unnumbered name in this section (normalized or raw)
      if (!folderExists) {
        folderExists = await GeneralFolder.findOne({
          $and: [
            {
              $or: [
                { name: finalFolder },
                { name: new RegExp(`^(\\d+\\.\\s*)?${unnumbered.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
              ]
            },
            {
              $or: [
                { section: section },
                { section: rawSection },
                { section: new RegExp(section, 'i') }
              ]
            }
          ]
        });
      }

      // 3. If still not found, search globally by name or unnumbered name
      if (!folderExists) {
        folderExists = await GeneralFolder.findOne({
          $or: [
            { name: finalFolder },
            { name: new RegExp(`^(\\d+\\.\\s*)?${unnumbered.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
          ]
        });
      }

      // 4. If folder truly does not exist in DB, create it automatically so upload NEVER fails with 404!
      if (!folderExists) {
        try {
          folderExists = await GeneralFolder.create({
            name: finalFolder,
            section: section,
            parentFolder: null
          });
        } catch (createErr) {
          folderExists = await GeneralFolder.findOne({ name: finalFolder });
        }
      }

      if (folderExists) {
        finalFolder = folderExists._id.toString();
      }
    }

    const currentUserId = (req.user._id || req.user.id || req.user.userId || 'user').toString();

    const isNcrSection = section === 'ncr';
    const document = await GeneralDocument.create({
      name,
      folder: finalFolder,
      section,
      category: category || '-',
      filePath: req.file.path,
      originalName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      uploadedBy: req.user._id || req.user.id,
      uploadedByName: req.user.name || req.user.userId || 'User',
      viewedBy: [currentUserId],
      ...(isNcrSection ? {
        ncStatus: 'NC Pending',
        approvalStatus: 'NC Pending',
        approvalAuthority: 'PMC',
        ncRequested: false,
        ncApprovedCompliance: false
      } : {})
    });

    // Trigger non-blocking async Email Notification to all 14 users
    notifyNewDocumentUpload({
      uploaderName: req.user.name || req.user.userId || 'PMIS User',
      docName: name,
      sectionName: section,
      folderName: folderExists ? folderExists.name : (finalFolder === 'Root' ? 'Root Folder' : folder),
      originalFileName: req.file.originalname,
      uploadedAt: document.uploadedAt,
      docId: document._id.toString(),
      docType: 'general'
    }).catch(err => console.error('[EmailTrigger Error]', err));

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
    const document = await GeneralDocument.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    let resolvedPath = path.resolve(document.filePath);
    if (!fs.existsSync(resolvedPath)) {
      resolvedPath = path.resolve(path.join(__dirname, '..', document.filePath));
    }
    const uploadDir = process.env.UPLOAD_DIR || 'uploads';
    if (!fs.existsSync(resolvedPath)) {
      resolvedPath = path.resolve(path.join(__dirname, '..', uploadDir, path.basename(document.filePath)));
    }
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
    const document = await GeneralDocument.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    let resolvedPath = path.resolve(document.filePath);
    if (!fs.existsSync(resolvedPath)) {
      resolvedPath = path.resolve(path.join(__dirname, '..', document.filePath));
    }
    const uploadDir = process.env.UPLOAD_DIR || 'uploads';
    if (!fs.existsSync(resolvedPath)) {
      resolvedPath = path.resolve(path.join(__dirname, '..', uploadDir, path.basename(document.filePath)));
    }
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
// @access  Private (NECPL / Admin / Uploader)
router.delete('/:id', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const document = await GeneralDocument.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const isUploader = document.uploadedBy && req.user && (
      document.uploadedBy.toString() === (req.user._id || req.user.id || '').toString()
    );

    const isFullRightsUser = req.user && (
      req.user.role === 'Site Engineer' ||
      (req.user.userId && req.user.userId.toUpperCase() === 'NECPL') ||
      (req.user.email && req.user.email.toLowerCase().includes('necpl')) ||
      (req.user.email && req.user.email.toLowerCase() === 'coordination.mmrcl@nyatigroup.com') ||
      (req.user.email && req.user.email.toLowerCase().includes('coordination.mmrcl')) ||
      (req.user.userId && req.user.userId.toLowerCase().includes('coordination.mmrcl')) ||
      (req.user.name && req.user.name.toLowerCase().includes('coordination.mmrcl')) ||
      section === 'registrations' ||
      isUploader
    );
    if (!isFullRightsUser) {
      return res.status(403).json({ success: false, message: 'Delete rights are reserved exclusively for NECPL (Admin).' });
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

// @desc    Rename or Move a document in a section
// @route   PUT /:id
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const { name, folder, category } = req.body;

    let updateFields = {};
    if (name) updateFields.name = name.trim();
    if (folder !== undefined) updateFields.folder = folder;
    if (category !== undefined) updateFields.category = category;
    if (req.body.ncStatus !== undefined) updateFields.ncStatus = req.body.ncStatus;
    if (req.body.ncRequested !== undefined) updateFields.ncRequested = req.body.ncRequested;
    if (req.body.ncRequestedBy !== undefined) updateFields.ncRequestedBy = req.body.ncRequestedBy;
    if (req.body.ncRequestedAt !== undefined) updateFields.ncRequestedAt = req.body.ncRequestedAt;
    if (req.body.ncApprovedCompliance !== undefined) updateFields.ncApprovedCompliance = req.body.ncApprovedCompliance;
    if (req.body.ncApprovedBy !== undefined) updateFields.ncApprovedBy = req.body.ncApprovedBy;
    if (req.body.ncApprovedAt !== undefined) updateFields.ncApprovedAt = req.body.ncApprovedAt;

    const document = await GeneralDocument.findByIdAndUpdate(req.params.id,
      updateFields,
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

    const document = await GeneralDocument.findById(req.params.id);
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



// @desc    Upload a sub-document / revision for a parent document
// @route   POST /:id/sub-document
// @access  Private
router.post('/:id/sub-document', protect, upload.single('file'), async (req, res) => {
  try {
    const section = getSection(req);
    const document = await GeneralDocument.findById(req.params.id);
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

    // Trigger non-blocking async Email Notification for sub-document revision
    notifyNewDocumentUpload({
      uploaderName: req.user.name || req.user.userId || 'PMIS User',
      docName: `${document.name} (Revision: ${subDoc.name})`,
      sectionName: section,
      folderName: document.folder || 'Sub-Document',
      originalFileName: req.file.originalname,
      uploadedAt: subDoc.uploadedAt,
      docId: document._id.toString(),
      docType: 'general'
    }).catch(err => console.error('[EmailTrigger Error]', err));

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
    const document = await GeneralDocument.findById(req.params.id);
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
    const document = await GeneralDocument.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Parent document not found' });
    }

    const subDoc = document.subDocuments.id(req.params.subId);
    if (!subDoc) {
      return res.status(404).json({ success: false, message: 'Sub-document not found' });
    }

    const uploadDir = process.env.UPLOAD_DIR || 'uploads';
    if (subDoc.filePath && typeof subDoc.filePath === 'string') {
      const filePath = path.join(uploadDir, path.basename(subDoc.filePath));
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.error('Error removing file:', e);
        }
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
    const document = await GeneralDocument.findById(req.params.id);
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
      filename: f.filename || path.basename(f.path),
      filePath: f.path || f.filename,
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
    const document = await GeneralDocument.findById(req.params.id);
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
    const document = await GeneralDocument.findById(req.params.id);
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
    const document = await GeneralDocument.findById(req.params.id);
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
    const document = await GeneralDocument.findById(req.params.id);
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

// @desc    Get all recent activity notifications across all sections (Uploads, Remarks, Approvals)
// @route   GET /all-uploads
// @access  Private
router.get('/all-uploads', protect, async (req, res) => {
  try {
    const documents = await GeneralDocument.find({
      uploadedAt: { $gte: notificationBaseline }
    })
      .populate('uploadedBy', 'name role userId')
      .sort({ updatedAt: -1 })
      .limit(60)
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

    const getHumanSectionName = (sec) => {
      if (sec === 'tender') return 'Tender Documents';
      if (sec === 'contractual') return 'Contractual Documents';
      if (sec === 'monitor') return 'Project Monitoring & Control';
      if (sec === 'drawing') return 'Project Drawings';
      if (sec === 'quality') return 'Quality Management';
      if (sec === 'ehs') return 'Environment, Health, and Safety (EHS)';
      if (sec === 'mep') return 'MEP & IT';
      if (sec === 'registrations') return 'Project Documents & Registration';
      if (sec === 'approved_nocs') return 'Approval & NOCs';
      if (sec === 'rfi') return 'RFI';
      return sec || 'General';
    };

    const notifications = [];

    documents.forEach(d => {
      const folderName = folderMap[d.folder] || (d.folder && d.folder !== 'Root' ? d.folder : 'Root Folder');
      const secName = getHumanSectionName(d.section);

      // 1. New File Upload Event
      notifications.push({
        _id: d._id.toString(),
        docId: d._id.toString(),
        type: 'upload',
        title: d.originalName || d.title || 'Untitled File',
        name: d.originalName || d.title || 'Untitled File',
        section: secName,
        apiSection: d.section,
        folderName: folderName,
        uploader: d.uploadedBy?.name || d.uploadedBy?.userId || 'NECPL',
        createdAt: d.uploadedAt || d.createdAt,
        uploadedAt: d.uploadedAt || d.createdAt,
        viewedBy: d.viewedBy || [],
        docRef: d
      });

      // 2. Remarks Added Events
      if (d.remarks && d.remarks.length > 0) {
        d.remarks.forEach((rem, idx) => {
          notifications.push({
            _id: `${d._id.toString()}_rem_${rem._id || idx}`,
            docId: d._id.toString(),
            type: 'remark',
            title: d.originalName || d.title || 'Untitled File',
            name: d.originalName || d.title || 'Untitled File',
            section: secName,
            apiSection: d.section,
            folderName: folderName,
            uploader: rem.userName || rem.userRole || 'User',
            remarkText: rem.text || '',
            createdAt: rem.createdAt || d.updatedAt,
            uploadedAt: rem.createdAt || d.updatedAt,
            viewedBy: rem.readBy || d.viewedBy || [],
            docRef: d
          });
        });
      }

      // 3. Approval Events
      if (d.approvedBy && d.approvedBy.trim() !== '') {
        notifications.push({
          _id: `${d._id.toString()}_app`,
          docId: d._id.toString(),
          type: 'approval',
          title: d.originalName || d.title || 'Untitled File',
          name: d.originalName || d.title || 'Untitled File',
          section: secName,
          apiSection: d.section,
          folderName: folderName,
          uploader: d.approvedBy,
          approvalStatus: d.approvalStatus || 'Approved',
          createdAt: d.updatedAt || d.uploadedAt,
          uploadedAt: d.updatedAt || d.uploadedAt,
          viewedBy: d.viewedBy || [],
          docRef: d
        });
      }
    });

    // Sort all notification items by createdAt / uploadedAt descending
    notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      success: true,
      count: notifications.length,
      data: notifications
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
    const document = await GeneralDocument.findById(req.params.id);
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
    const document = await GeneralDocument.findByIdAndUpdate(req.params.id,
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

// @desc    Download a sub-document file
// @route   GET /:id/sub-document/:subId/download
// @access  Private
router.get('/:id/sub-document/:subId/download', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const document = await GeneralDocument.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Parent document not found' });
    }

    const subDoc = document.subDocuments.id(req.params.subId);
    if (!subDoc) {
      return res.status(404).json({ success: false, message: 'Sub-document not found' });
    }

    const uploadDir = process.env.UPLOAD_DIR || 'uploads';
    if (!subDoc.filePath || typeof subDoc.filePath !== 'string') {
      return res.status(404).json({ success: false, message: 'Physical file path not found for this sub-document' });
    }
    // filePath may be stored as just the filename or as a full path
    const filename = path.basename(subDoc.filePath);
    const resolvedPath = path.resolve(path.join(uploadDir, filename));

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ success: false, message: 'Physical file not found on server storage' });
    }

    res.download(resolvedPath, subDoc.originalName || filename);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    View a sub-document file inline
// @route   GET /:id/sub-document/:subId/view
// @access  Private
router.get('/:id/sub-document/:subId/view', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const document = await GeneralDocument.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Parent document not found' });
    }

    const subDoc = document.subDocuments.id(req.params.subId);
    if (!subDoc) {
      return res.status(404).json({ success: false, message: 'Sub-document not found' });
    }

    const uploadDir = process.env.UPLOAD_DIR || 'uploads';
    if (!subDoc.filePath || typeof subDoc.filePath !== 'string') {
      return res.status(404).json({ success: false, message: 'Physical file path not found for this sub-document' });
    }
    const filename = path.basename(subDoc.filePath);
    const resolvedPath = path.resolve(path.join(uploadDir, filename));

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ success: false, message: 'Physical file not found on server storage' });
    }

    if (subDoc.mimeType) {
      res.setHeader('Content-Type', subDoc.mimeType);
    }
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(subDoc.originalName || filename)}"`);
    res.sendFile(resolvedPath);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Update document approval authority
// @route   PUT /:id/approval-authority
// @access  Private
router.put('/:id/approval-authority', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const { authority } = req.body;
    
    const document = await GeneralDocument.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    if (authority && authority.trim() !== '') {
      document.approvalAuthority = authority.trim();
      document.approvalStatus = 'Unapproved';
      document.approvedBy = '';
    } else {
      document.approvalAuthority = '';
      document.approvalStatus = 'Approved';
      document.approvedBy = '';
    }

    await document.save();
    res.status(200).json({ success: true, data: document });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Approve document
// @desc    Approve document
// @route   POST /:id/approve
// @access  Private
router.post('/:id/approve', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const document = await GeneralDocument.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const authority = document.approvalAuthority;
    if (!authority) {
      return res.status(400).json({ success: false, message: 'No approval authority assigned' });
    }

    const authList = authority.split(',').map(a => a.trim().toUpperCase()).filter(Boolean);
    const user = req.user;
    const userName = (user.name || '').toUpperCase();
    const userId = (user.userId || '').toUpperCase();
    const userOrg = (user.organization || '').toUpperCase();
    const userRole = (user.role || '').toUpperCase();

    // Check matched authority
    let matchedAuth = authList.find(authUpper => {
      if (userRole.includes('ADMIN') || userId === 'ADMIN' || userId === 'NECPL' || userOrg.includes('NECPL')) return true;
      if (authUpper.includes('KULKARNI') || authUpper.includes('MADHAVESH')) {
        return userName.includes('PMC') || userName.includes('MADHAVESH') || userName.includes('KULKARNI') || userOrg.includes('PMC') || userId.includes('PMC');
      }
      if (authUpper.includes('VISHWAS') || authUpper.includes('AJNALKAR')) {
        return userName.includes('VISHWAS') || userName.includes('AJNALKAR') || userOrg.includes('MMRCL') || userId.includes('MMRCL');
      }
      if (authUpper.includes('AASIM') || authUpper.includes('SULAIMAN')) {
        return userName.includes('AASIM') || userName.includes('SULAIMAN') || userOrg.includes('MMRCL') || userId.includes('MMRCL');
      }
      if (authUpper.includes('PATIL') || authUpper.includes('RAJESH')) {
        return userName.includes('RAJESH') || userName.includes('PATIL') || userOrg.includes('MMRCL') || userId.includes('MMRCL');
      }
      if (authUpper.includes('SACHIN') || authUpper.includes('AHER')) {
        return userName.includes('SACHIN') || userName.includes('AHER') || userOrg.includes('MMRCL') || userId.includes('MMRCL');
      }
      return (
        userName.includes(authUpper) ||
        userId.includes(authUpper) ||
        userOrg.includes(authUpper) ||
        userRole.includes(authUpper)
      );
    });

    if (!matchedAuth) {
      return res.status(403).json({
        success: false,
        message: `Only users representing ${authority} are authorized to approve this document.`
      });
    }

    const originalAuthList = authority.split(',').map(a => a.trim()).filter(Boolean);
    let matchedOriginalAuth = originalAuthList.find(a => a.toUpperCase() === matchedAuth);
    if (!matchedOriginalAuth) {
      // If user matched generally (e.g. MMRCL or PMC or Admin or Architect)
      if (userName.includes('PRIYADARSHINI') || userName.includes('AGRAWAL') || userOrg.includes('ARCHITECT')) matchedOriginalAuth = 'Architect - Ar. Priyadarshini Agrawal';
      else if (userName.includes('VISHWAS') || userName.includes('AJNALKAR')) matchedOriginalAuth = 'MMRCL - Dr. Vishwas Ajnalkar';
      else if (userName.includes('AASIM') || userName.includes('SULAIMAN')) matchedOriginalAuth = 'MMRCL - Md Aasim Sulaiman';
      else if (userName.includes('RAJESH') || userName.includes('PATIL')) matchedOriginalAuth = 'MMRCL - Mr Rajesh Patil';
      else if (userName.includes('SACHIN') || userName.includes('AHER')) matchedOriginalAuth = 'MMRCL - Mr Sachin Aher';
      else if (userOrg.includes('MMRCL') || userId.includes('MMRCL')) {
        matchedOriginalAuth = originalAuthList.find(a => a.includes('MMRCL')) || 'MMRCL';
      } else if (userOrg.includes('PMC') || userId.includes('PMC')) {
        matchedOriginalAuth = originalAuthList.find(a => a.includes('PMC')) || 'PMC - Mr. Madhavesh Kulkarni';
      } else {
        matchedOriginalAuth = originalAuthList[0];
      }
    }

    let currentApprovedArray = document.approvedBy ? document.approvedBy.split(',').map(a => a.trim()).filter(Boolean) : [];

    // Sequential approval check: Project Drawings vs MEP vs RFI vs Project Monitoring & Control
    if (section === 'project_drawings' || section === 'drawings' || (authority.includes('Architect') && authority.includes('Vikrant'))) {
      const hasArchAssigned = originalAuthList.some(a => a.includes('Architect') || a.includes('Agrawal'));
      const hasArchApproved = currentApprovedArray.some(a => a.includes('Architect') || a.includes('Agrawal'));

      const hasPmcAssigned = originalAuthList.some(a => a.includes('PMC'));
      const hasPmcApproved = currentApprovedArray.some(a => a.includes('PMC'));

      const hasVikrantAssigned = originalAuthList.some(a => a.includes('Vikrant') || a.includes('Tewathia'));
      const hasVikrantApproved = currentApprovedArray.some(a => a.includes('Vikrant') || a.includes('Tewathia'));

      if (matchedOriginalAuth.includes('PMC') && hasArchAssigned && !hasArchApproved) {
        return res.status(403).json({ success: false, message: 'Architect - Ar. Priyadarshini Agrawal must approve first before PMC can approve.' });
      }

      if ((matchedOriginalAuth.includes('Vikrant') || matchedOriginalAuth.includes('Tewathia')) && ((hasArchAssigned && !hasArchApproved) || (hasPmcAssigned && !hasPmcApproved))) {
        return res.status(403).json({ success: false, message: 'PMC - Mr. Madhavesh Kulkarni must approve first before MMRCL - Mr Vikrant Tewathia can approve.' });
      }

      const isFinalMmrclOfficer = matchedOriginalAuth.includes('MMRCL') && !matchedOriginalAuth.includes('Vikrant') && !matchedOriginalAuth.includes('Tewathia');
      if (isFinalMmrclOfficer) {
        if (hasArchAssigned && !hasArchApproved) return res.status(403).json({ success: false, message: 'Architect - Ar. Priyadarshini Agrawal must approve first.' });
        if (hasPmcAssigned && !hasPmcApproved) return res.status(403).json({ success: false, message: 'PMC - Mr. Madhavesh Kulkarni must approve first.' });
        if (hasVikrantAssigned && !hasVikrantApproved) return res.status(403).json({ success: false, message: 'MMRCL - Mr Vikrant Tewathia must approve first before final MMRCL approval.' });
      }
    } else if (section === 'rfi') {
      const hasArchAssigned = originalAuthList.some(a => a.includes('Architect') || a.includes('Agrawal') || a.includes('Priyadarshini'));
      const hasArchApproved = currentApprovedArray.some(a => a.includes('Architect') || a.includes('Agrawal') || a.includes('Priyadarshini'));

      const hasPmcAssigned = originalAuthList.some(a => a.includes('PMC'));
      const hasPmcApproved = currentApprovedArray.some(a => a.includes('PMC'));

      if (matchedOriginalAuth.includes('PMC') && hasArchAssigned && !hasArchApproved) {
        return res.status(403).json({ success: false, message: 'Architect - Ar. Priyadarshini Agrawal must approve first before PMC can approve.' });
      }

      if (matchedOriginalAuth.includes('MMRCL')) {
        if (hasArchAssigned && !hasArchApproved) return res.status(403).json({ success: false, message: 'Architect - Ar. Priyadarshini Agrawal must approve first.' });
        if (hasPmcAssigned && !hasPmcApproved) return res.status(403).json({ success: false, message: 'PMC - Mr. Madhavesh Kulkarni must approve first.' });
      }
    } else if (section === 'mep' || authority.includes('Vishwas') || authority.includes('Ajnalkar')) {
      const hasPmcAssigned = originalAuthList.some(a => a.includes('PMC'));
      const hasPmcApproved = currentApprovedArray.some(a => a.includes('PMC'));

      const hasVishwasAssigned = originalAuthList.some(a => a.includes('Vishwas') || a.includes('Ajnalkar'));
      const hasVishwasApproved = currentApprovedArray.some(a => a.includes('Vishwas') || a.includes('Ajnalkar'));

      if ((matchedOriginalAuth.includes('Vishwas') || matchedOriginalAuth.includes('Ajnalkar')) && hasPmcAssigned && !hasPmcApproved) {
        return res.status(403).json({ success: false, message: 'PMC - Mr. Madhavesh Kulkarni must approve first before MMRCL - Dr. Vishwas Ajnalkar can approve.' });
      }

      const isFinalMmrclOfficer = matchedOriginalAuth.includes('MMRCL') && !matchedOriginalAuth.includes('Vishwas') && !matchedOriginalAuth.includes('Ajnalkar');
      if (isFinalMmrclOfficer) {
        if (hasPmcAssigned && !hasPmcApproved) return res.status(403).json({ success: false, message: 'PMC - Mr. Madhavesh Kulkarni must approve first.' });
        if (hasVishwasAssigned && !hasVishwasApproved) return res.status(403).json({ success: false, message: 'MMRCL - Dr. Vishwas Ajnalkar must approve first before final MMRCL approval.' });
      }
    } else if (section === 'project_monitoring_control' || section === 'pmc' || section === 'quality_management' || section === 'quality' || section === 'ehs' || section === 'environment_health_safety' || authority.includes('PMC')) {
      const hasPmcAssigned = originalAuthList.some(a => a.includes('PMC'));
      const hasPmcApproved = currentApprovedArray.some(a => a.includes('PMC'));

      if (matchedOriginalAuth.includes('MMRCL') && hasPmcAssigned && !hasPmcApproved) {
        return res.status(403).json({
          success: false,
          message: 'PMC - Mr. Madhavesh Kulkarni must approve first before MMRCL can approve.'
        });
      }
    }

    if (matchedOriginalAuth && !currentApprovedArray.includes(matchedOriginalAuth)) {
      currentApprovedArray.push(matchedOriginalAuth);
    }

    document.approvedBy = currentApprovedArray.join(', ');

    // Check full approval completion
    if (section === 'project_drawings' || section === 'drawings' || authority.includes('Architect') || authority.includes('Agrawal')) {
      const hasArchAssigned = originalAuthList.some(a => a.includes('Architect') || a.includes('Agrawal'));
      const hasArchApproved = currentApprovedArray.some(a => a.includes('Architect') || a.includes('Agrawal'));

      const hasPmcAssigned = originalAuthList.some(a => a.includes('PMC'));
      const hasPmcApproved = currentApprovedArray.some(a => a.includes('PMC'));

      const hasVikrantAssigned = originalAuthList.some(a => a.includes('Vikrant') || a.includes('Tewathia'));
      const hasVikrantApproved = currentApprovedArray.some(a => a.includes('Vikrant') || a.includes('Tewathia'));

      const finalMmrclAssigned = originalAuthList.filter(a => a.includes('MMRCL') && !a.includes('Vikrant') && !a.includes('Tewathia'));
      const hasFinalMmrclApproved = finalMmrclAssigned.length > 0 ? currentApprovedArray.some(a => a.includes('MMRCL') && !a.includes('Vikrant') && !a.includes('Tewathia')) : true;

      const archOk = !hasArchAssigned || hasArchApproved;
      const pmcOk = !hasPmcAssigned || hasPmcApproved;
      const vikrantOk = !hasVikrantAssigned || hasVikrantApproved;

      if (archOk && pmcOk && vikrantOk && hasFinalMmrclApproved) {
        document.approvalStatus = 'Approved';
      }
    } else if (section === 'mep' || authority.includes('Vishwas') || authority.includes('Ajnalkar')) {
      const hasPmcAssigned = originalAuthList.some(a => a.includes('PMC'));
      const hasPmcApproved = currentApprovedArray.some(a => a.includes('PMC'));

      const hasVishwasAssigned = originalAuthList.some(a => a.includes('Vishwas') || a.includes('Ajnalkar'));
      const hasVishwasApproved = currentApprovedArray.some(a => a.includes('Vishwas') || a.includes('Ajnalkar'));

      const finalMmrclAssigned = originalAuthList.filter(a => a.includes('MMRCL') && !a.includes('Vishwas') && !a.includes('Ajnalkar'));
      const hasFinalMmrclApproved = finalMmrclAssigned.length > 0 ? currentApprovedArray.some(a => a.includes('MMRCL') && !a.includes('Vishwas') && !a.includes('Ajnalkar')) : true;

      const pmcOk = !hasPmcAssigned || hasPmcApproved;
      const vishwasOk = !hasVishwasAssigned || hasVishwasApproved;

      if (pmcOk && vishwasOk && hasFinalMmrclApproved) {
        document.approvalStatus = 'Approved';
      }
    } else if (section === 'project_monitoring_control' || section === 'pmc' || section === 'quality_management' || section === 'quality' || section === 'ehs' || section === 'environment_health_safety' || authority.includes('PMC')) {
      const hasPmcAssigned = originalAuthList.some(a => a.includes('PMC'));
      const hasPmcApproved = currentApprovedArray.some(a => a.includes('PMC'));

      if (matchedOriginalAuth.includes('MMRCL') && hasPmcAssigned && !hasPmcApproved) {
        return res.status(403).json({
          success: false,
          message: 'PMC - Mr. Madhavesh Kulkarni must approve first before MMRCL can approve.'
        });
      }
    }

    if (matchedOriginalAuth && !currentApprovedArray.includes(matchedOriginalAuth)) {
      currentApprovedArray.push(matchedOriginalAuth);
    }

    document.approvedBy = currentApprovedArray.join(', ');

    // Check full approval completion
    if (section === 'project_drawings' || section === 'drawings' || authority.includes('Architect') || authority.includes('Agrawal')) {
      const hasArchAssigned = originalAuthList.some(a => a.includes('Architect') || a.includes('Agrawal'));
      const hasArchApproved = currentApprovedArray.some(a => a.includes('Architect') || a.includes('Agrawal'));

      const hasPmcAssigned = originalAuthList.some(a => a.includes('PMC'));
      const hasPmcApproved = currentApprovedArray.some(a => a.includes('PMC'));

      const hasVikrantAssigned = originalAuthList.some(a => a.includes('Vikrant') || a.includes('Tewathia'));
      const hasVikrantApproved = currentApprovedArray.some(a => a.includes('Vikrant') || a.includes('Tewathia'));

      const finalMmrclAssigned = originalAuthList.filter(a => a.includes('MMRCL') && !a.includes('Vikrant') && !a.includes('Tewathia'));
      const hasFinalMmrclApproved = finalMmrclAssigned.length > 0 ? currentApprovedArray.some(a => a.includes('MMRCL') && !a.includes('Vikrant') && !a.includes('Tewathia')) : true;

      const archOk = !hasArchAssigned || hasArchApproved;
      const pmcOk = !hasPmcAssigned || hasPmcApproved;
      const vikrantOk = !hasVikrantAssigned || hasVikrantApproved;

      if (archOk && pmcOk && vikrantOk && hasFinalMmrclApproved) {
        document.approvalStatus = 'Approved';
      }
    } else if (section === 'project_monitoring_control' || section === 'pmc' || section === 'quality_management' || section === 'quality' || section === 'ehs' || section === 'environment_health_safety' || authority.includes('PMC')) {
      const hasPmcAssigned = originalAuthList.some(a => a.includes('PMC'));
      const hasPmcApproved = currentApprovedArray.some(a => a.includes('PMC'));
      const mmrclAssigned = originalAuthList.filter(a => a.includes('MMRCL'));
      const hasMmrclApproved = mmrclAssigned.length > 0 ? currentApprovedArray.some(a => a.includes('MMRCL')) : true;

      if ((!hasPmcAssigned || hasPmcApproved) && hasMmrclApproved) {
        document.approvalStatus = 'Approved';
      }
    } else {
      const isFullyApproved = originalAuthList.every(a => currentApprovedArray.includes(a));
      if (isFullyApproved) {
        document.approvalStatus = 'Approved';
      }
    }

    await document.save();
    res.status(200).json({ success: true, data: document });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Update sub-document approval authority
// @route   PUT /:id/sub-document/:subId/approval-authority
// @access  Private
router.put('/:id/sub-document/:subId/approval-authority', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const { authority } = req.body;

    const document = await GeneralDocument.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Parent document not found' });
    }

    const subDoc = document.subDocuments.id(req.params.subId);
    if (!subDoc) {
      return res.status(404).json({ success: false, message: 'Sub-document not found' });
    }

    if (authority && authority.trim() !== '') {
      subDoc.approvalAuthority = authority.trim();
      subDoc.approvalStatus = 'Unapproved';
      subDoc.approvedBy = '';
    } else {
      subDoc.approvalAuthority = '';
      subDoc.approvalStatus = 'Approved';
      subDoc.approvedBy = '';
    }

    await document.save();
    res.status(200).json({ success: true, data: document });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Approve sub-document
// @route   POST /:id/sub-document/:subId/approve
// @access  Private
router.post('/:id/sub-document/:subId/approve', protect, async (req, res) => {
  try {
    const section = getSection(req);
    const document = await GeneralDocument.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Parent document not found' });
    }

    const subDoc = document.subDocuments.id(req.params.subId);
    if (!subDoc) {
      return res.status(404).json({ success: false, message: 'Sub-document not found' });
    }

    const authority = subDoc.approvalAuthority;
    if (!authority) {
      return res.status(400).json({ success: false, message: 'No approval authority assigned' });
    }

    const authList = authority.split(',').map(a => a.trim().toUpperCase()).filter(Boolean);
    const user = req.user;
    const userName = (user.name || '').toUpperCase();
    const userId = (user.userId || '').toUpperCase();
    const userOrg = (user.organization || '').toUpperCase();
    const userRole = (user.role || '').toUpperCase();

    let matchedAuth = authList.find(authUpper => {
      if (userRole.includes('ADMIN') || userId === 'ADMIN' || userId === 'NECPL' || userOrg.includes('NECPL')) return true;
      if (authUpper.includes('KULKARNI') || authUpper.includes('MADHAVESH')) {
        return userName.includes('PMC') || userName.includes('MADHAVESH') || userName.includes('KULKARNI') || userOrg.includes('PMC') || userId.includes('PMC');
      }
      if (authUpper.includes('VISHWAS') || authUpper.includes('AJNALKAR')) {
        return userName.includes('VISHWAS') || userName.includes('AJNALKAR') || userOrg.includes('MMRCL') || userId.includes('MMRCL');
      }
      if (authUpper.includes('AASIM') || authUpper.includes('SULAIMAN')) {
        return userName.includes('AASIM') || userName.includes('SULAIMAN') || userOrg.includes('MMRCL') || userId.includes('MMRCL');
      }
      if (authUpper.includes('PATIL') || authUpper.includes('RAJESH')) {
        return userName.includes('RAJESH') || userName.includes('PATIL') || userOrg.includes('MMRCL') || userId.includes('MMRCL');
      }
      if (authUpper.includes('SACHIN') || authUpper.includes('AHER')) {
        return userName.includes('SACHIN') || userName.includes('AHER') || userOrg.includes('MMRCL') || userId.includes('MMRCL');
      }
      return (
        userName.includes(authUpper) ||
        userId.includes(authUpper) ||
        userOrg.includes(authUpper) ||
        userRole.includes(authUpper)
      );
    });

    if (!matchedAuth) {
      return res.status(403).json({
        success: false,
        message: `Only users representing ${authority} are authorized to approve this sub-document.`
      });
    }

    const originalAuthList = authority.split(',').map(a => a.trim()).filter(Boolean);
    let matchedOriginalAuth = originalAuthList.find(a => a.toUpperCase() === matchedAuth);
    if (!matchedOriginalAuth) {
      if (userName.includes('PRIYADARSHINI') || userName.includes('AGRAWAL') || userOrg.includes('ARCHITECT')) matchedOriginalAuth = 'Architect - Ar. Priyadarshini Agrawal';
      else if (userName.includes('VISHWAS') || userName.includes('AJNALKAR')) matchedOriginalAuth = 'MMRCL - Dr. Vishwas Ajnalkar';
      else if (userName.includes('AASIM') || userName.includes('SULAIMAN')) matchedOriginalAuth = 'MMRCL - Md Aasim Sulaiman';
      else if (userName.includes('RAJESH') || userName.includes('PATIL')) matchedOriginalAuth = 'MMRCL - Mr Rajesh Patil';
      else if (userName.includes('SACHIN') || userName.includes('AHER')) matchedOriginalAuth = 'MMRCL - Mr Sachin Aher';
      else if (userOrg.includes('MMRCL') || userId.includes('MMRCL')) {
        matchedOriginalAuth = originalAuthList.find(a => a.includes('MMRCL')) || 'MMRCL';
      } else if (userOrg.includes('PMC') || userId.includes('PMC')) {
        matchedOriginalAuth = originalAuthList.find(a => a.includes('PMC')) || 'PMC - Mr. Madhavesh Kulkarni';
      } else {
        matchedOriginalAuth = originalAuthList[0];
      }
    }

    let currentApprovedArray = subDoc.approvedBy ? subDoc.approvedBy.split(',').map(a => a.trim()).filter(Boolean) : [];

    // Sequential approval check: Project Drawings vs MEP vs RFI vs Project Monitoring & Control
    if (section === 'project_drawings' || section === 'drawings' || (authority.includes('Architect') && authority.includes('Vikrant'))) {
      const hasArchAssigned = originalAuthList.some(a => a.includes('Architect') || a.includes('Agrawal'));
      const hasArchApproved = currentApprovedArray.some(a => a.includes('Architect') || a.includes('Agrawal'));

      const hasPmcAssigned = originalAuthList.some(a => a.includes('PMC'));
      const hasPmcApproved = currentApprovedArray.some(a => a.includes('PMC'));

      const hasVikrantAssigned = originalAuthList.some(a => a.includes('Vikrant') || a.includes('Tewathia'));
      const hasVikrantApproved = currentApprovedArray.some(a => a.includes('Vikrant') || a.includes('Tewathia'));

      if (matchedOriginalAuth.includes('PMC') && hasArchAssigned && !hasArchApproved) {
        return res.status(403).json({ success: false, message: 'Architect - Ar. Priyadarshini Agrawal must approve first before PMC can approve.' });
      }

      if ((matchedOriginalAuth.includes('Vikrant') || matchedOriginalAuth.includes('Tewathia')) && ((hasArchAssigned && !hasArchApproved) || (hasPmcAssigned && !hasPmcApproved))) {
        return res.status(403).json({ success: false, message: 'PMC - Mr. Madhavesh Kulkarni must approve first before MMRCL - Mr Vikrant Tewathia can approve.' });
      }

      const isFinalMmrclOfficer = matchedOriginalAuth.includes('MMRCL') && !matchedOriginalAuth.includes('Vikrant') && !matchedOriginalAuth.includes('Tewathia');
      if (isFinalMmrclOfficer) {
        if (hasArchAssigned && !hasArchApproved) return res.status(403).json({ success: false, message: 'Architect - Ar. Priyadarshini Agrawal must approve first.' });
        if (hasPmcAssigned && !hasPmcApproved) return res.status(403).json({ success: false, message: 'PMC - Mr. Madhavesh Kulkarni must approve first.' });
        if (hasVikrantAssigned && !hasVikrantApproved) return res.status(403).json({ success: false, message: 'MMRCL - Mr Vikrant Tewathia must approve first before final MMRCL approval.' });
      }
    } else if (section === 'rfi') {
      const hasArchAssigned = originalAuthList.some(a => a.includes('Architect') || a.includes('Agrawal') || a.includes('Priyadarshini'));
      const hasArchApproved = currentApprovedArray.some(a => a.includes('Architect') || a.includes('Agrawal') || a.includes('Priyadarshini'));

      const hasPmcAssigned = originalAuthList.some(a => a.includes('PMC'));
      const hasPmcApproved = currentApprovedArray.some(a => a.includes('PMC'));

      if (matchedOriginalAuth.includes('PMC') && hasArchAssigned && !hasArchApproved) {
        return res.status(403).json({ success: false, message: 'Architect - Ar. Priyadarshini Agrawal must approve first before PMC can approve.' });
      }

      if (matchedOriginalAuth.includes('MMRCL')) {
        if (hasArchAssigned && !hasArchApproved) return res.status(403).json({ success: false, message: 'Architect - Ar. Priyadarshini Agrawal must approve first.' });
        if (hasPmcAssigned && !hasPmcApproved) return res.status(403).json({ success: false, message: 'PMC - Mr. Madhavesh Kulkarni must approve first.' });
      }
    } else if (section === 'mep' || authority.includes('Vishwas') || authority.includes('Ajnalkar')) {
      const hasPmcAssigned = originalAuthList.some(a => a.includes('PMC'));
      const hasPmcApproved = currentApprovedArray.some(a => a.includes('PMC'));

      const hasVishwasAssigned = originalAuthList.some(a => a.includes('Vishwas') || a.includes('Ajnalkar'));
      const hasVishwasApproved = currentApprovedArray.some(a => a.includes('Vishwas') || a.includes('Ajnalkar'));

      if ((matchedOriginalAuth.includes('Vishwas') || matchedOriginalAuth.includes('Ajnalkar')) && hasPmcAssigned && !hasPmcApproved) {
        return res.status(403).json({ success: false, message: 'PMC - Mr. Madhavesh Kulkarni must approve first before MMRCL - Dr. Vishwas Ajnalkar can approve.' });
      }

      const isFinalMmrclOfficer = matchedOriginalAuth.includes('MMRCL') && !matchedOriginalAuth.includes('Vishwas') && !matchedOriginalAuth.includes('Ajnalkar');
      if (isFinalMmrclOfficer) {
        if (hasPmcAssigned && !hasPmcApproved) return res.status(403).json({ success: false, message: 'PMC - Mr. Madhavesh Kulkarni must approve first.' });
        if (hasVishwasAssigned && !hasVishwasApproved) return res.status(403).json({ success: false, message: 'MMRCL - Dr. Vishwas Ajnalkar must approve first before final MMRCL approval.' });
      }
    } else if (section === 'project_monitoring_control' || section === 'pmc' || section === 'quality_management' || section === 'quality' || section === 'ehs' || section === 'environment_health_safety' || authority.includes('PMC')) {
      const hasPmcAssigned = originalAuthList.some(a => a.includes('PMC'));
      const hasPmcApproved = currentApprovedArray.some(a => a.includes('PMC'));

      if (matchedOriginalAuth.includes('MMRCL') && hasPmcAssigned && !hasPmcApproved) {
        return res.status(403).json({
          success: false,
          message: 'PMC - Mr. Madhavesh Kulkarni must approve first before MMRCL can approve.'
        });
      }
    }

    if (matchedOriginalAuth && !currentApprovedArray.includes(matchedOriginalAuth)) {
      currentApprovedArray.push(matchedOriginalAuth);
    }

    subDoc.approvedBy = currentApprovedArray.join(', ');

    // Check full approval completion
    if (section === 'project_drawings' || section === 'drawings' || authority.includes('Architect') || authority.includes('Agrawal')) {
      const hasArchAssigned = originalAuthList.some(a => a.includes('Architect') || a.includes('Agrawal'));
      const hasArchApproved = currentApprovedArray.some(a => a.includes('Architect') || a.includes('Agrawal'));

      const hasPmcAssigned = originalAuthList.some(a => a.includes('PMC'));
      const hasPmcApproved = currentApprovedArray.some(a => a.includes('PMC'));

      const hasVikrantAssigned = originalAuthList.some(a => a.includes('Vikrant') || a.includes('Tewathia'));
      const hasVikrantApproved = currentApprovedArray.some(a => a.includes('Vikrant') || a.includes('Tewathia'));

      const finalMmrclAssigned = originalAuthList.filter(a => a.includes('MMRCL') && !a.includes('Vikrant') && !a.includes('Tewathia'));
      const hasFinalMmrclApproved = finalMmrclAssigned.length > 0 ? currentApprovedArray.some(a => a.includes('MMRCL') && !a.includes('Vikrant') && !a.includes('Tewathia')) : true;

      const archOk = !hasArchAssigned || hasArchApproved;
      const pmcOk = !hasPmcAssigned || hasPmcApproved;
      const vikrantOk = !hasVikrantAssigned || hasVikrantApproved;

      if (archOk && pmcOk && vikrantOk && hasFinalMmrclApproved) {
        subDoc.approvalStatus = 'Approved';
      }
    } else if (section === 'mep' || authority.includes('Vishwas') || authority.includes('Ajnalkar')) {
      const hasPmcAssigned = originalAuthList.some(a => a.includes('PMC'));
      const hasPmcApproved = currentApprovedArray.some(a => a.includes('PMC'));

      const hasVishwasAssigned = originalAuthList.some(a => a.includes('Vishwas') || a.includes('Ajnalkar'));
      const hasVishwasApproved = currentApprovedArray.some(a => a.includes('Vishwas') || a.includes('Ajnalkar'));

      const finalMmrclAssigned = originalAuthList.filter(a => a.includes('MMRCL') && !a.includes('Vishwas') && !a.includes('Ajnalkar'));
      const hasFinalMmrclApproved = finalMmrclAssigned.length > 0 ? currentApprovedArray.some(a => a.includes('MMRCL') && !a.includes('Vishwas') && !a.includes('Ajnalkar')) : true;

      const pmcOk = !hasPmcAssigned || hasPmcApproved;
      const vishwasOk = !hasVishwasAssigned || hasVishwasApproved;

      if (pmcOk && vishwasOk && hasFinalMmrclApproved) {
        subDoc.approvalStatus = 'Approved';
      }
    } else if (section === 'project_monitoring_control' || section === 'pmc' || section === 'quality_management' || section === 'quality' || section === 'ehs' || section === 'environment_health_safety' || authority.includes('PMC')) {
      const hasPmcAssigned = originalAuthList.some(a => a.includes('PMC'));
      const hasPmcApproved = currentApprovedArray.some(a => a.includes('PMC'));

      if (matchedOriginalAuth.includes('MMRCL') && hasPmcAssigned && !hasPmcApproved) {
        return res.status(403).json({
          success: false,
          message: 'PMC - Mr. Madhavesh Kulkarni must approve first before MMRCL can approve.'
        });
      }
    }

    if (matchedOriginalAuth && !currentApprovedArray.includes(matchedOriginalAuth)) {
      currentApprovedArray.push(matchedOriginalAuth);
    }

    subDoc.approvedBy = currentApprovedArray.join(', ');

    // Check full approval completion
    if (section === 'project_drawings' || section === 'drawings' || authority.includes('Architect') || authority.includes('Agrawal')) {
      const hasArchAssigned = originalAuthList.some(a => a.includes('Architect') || a.includes('Agrawal'));
      const hasArchApproved = currentApprovedArray.some(a => a.includes('Architect') || a.includes('Agrawal'));

      const hasPmcAssigned = originalAuthList.some(a => a.includes('PMC'));
      const hasPmcApproved = currentApprovedArray.some(a => a.includes('PMC'));

      const hasVikrantAssigned = originalAuthList.some(a => a.includes('Vikrant') || a.includes('Tewathia'));
      const hasVikrantApproved = currentApprovedArray.some(a => a.includes('Vikrant') || a.includes('Tewathia'));

      const finalMmrclAssigned = originalAuthList.filter(a => a.includes('MMRCL') && !a.includes('Vikrant') && !a.includes('Tewathia'));
      const hasFinalMmrclApproved = finalMmrclAssigned.length > 0 ? currentApprovedArray.some(a => a.includes('MMRCL') && !a.includes('Vikrant') && !a.includes('Tewathia')) : true;

      const archOk = !hasArchAssigned || hasArchApproved;
      const pmcOk = !hasPmcAssigned || hasPmcApproved;
      const vikrantOk = !hasVikrantAssigned || hasVikrantApproved;

      if (archOk && pmcOk && vikrantOk && hasFinalMmrclApproved) {
        subDoc.approvalStatus = 'Approved';
      }
    } else if (section === 'project_monitoring_control' || section === 'pmc' || section === 'quality_management' || section === 'quality' || section === 'ehs' || section === 'environment_health_safety' || authority.includes('PMC')) {
      const hasPmcAssigned = originalAuthList.some(a => a.includes('PMC'));
      const hasPmcApproved = currentApprovedArray.some(a => a.includes('PMC'));
      const mmrclAssigned = originalAuthList.filter(a => a.includes('MMRCL'));
      const hasMmrclApproved = mmrclAssigned.length > 0 ? currentApprovedArray.some(a => a.includes('MMRCL')) : true;

      if ((!hasPmcAssigned || hasPmcApproved) && hasMmrclApproved) {
        subDoc.approvalStatus = 'Approved';
      }
    } else {
      const isFullyApproved = originalAuthList.every(a => currentApprovedArray.includes(a));
      if (isFullyApproved) {
        subDoc.approvalStatus = 'Approved';
      }
    }

    await document.save();
    res.status(200).json({ success: true, data: document });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});


// @route   PUT /:id/ncr-request
// @desc    NECPL submits request to remove NC
// @access  Private
router.put('/:id/ncr-request', protect, async (req, res) => {
  try {
    const document = await GeneralDocument.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }
    const requesterName = req.user.name || req.user.userId || 'NECPL';
    document.ncRequested = true;
    document.ncRequestedBy = requesterName;
    document.ncRequestedAt = new Date();
    document.ncStatus = 'NC Pending';
    await document.save();
    res.status(200).json({ success: true, data: document });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @route   PUT /:id/ncr-approve
// @desc    PMC approves compliance and removes NC
// @access  Private
router.put('/:id/ncr-approve', protect, async (req, res) => {
  try {
    const document = await GeneralDocument.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }
    const approverName = req.user.name || req.user.userId || 'PMC';
    document.ncApprovedCompliance = true;
    document.ncApprovedBy = approverName;
    document.ncApprovedAt = new Date();
    document.ncStatus = 'NC Removed';
    document.approvalStatus = 'Approved';
    await document.save();
    res.status(200).json({ success: true, data: document });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @route   PUT /:id/sub-document/:subId/ncr-request
// @desc    NECPL submits request to remove NC for sub-document
// @access  Private
router.put('/:id/sub-document/:subId/ncr-request', protect, async (req, res) => {
  try {
    const document = await GeneralDocument.findById(req.params.id);
    if (!document) return res.status(404).json({ success: false, message: 'Document not found' });
    const subDoc = document.subDocuments.id(req.params.subId);
    if (!subDoc) return res.status(404).json({ success: false, message: 'Sub-document not found' });

    const requesterName = req.user.name || req.user.userId || 'NECPL';
    subDoc.ncRequested = true;
    subDoc.ncRequestedBy = requesterName;
    subDoc.ncRequestedAt = new Date();
    subDoc.ncStatus = 'NC Pending';
    await document.save();
    res.status(200).json({ success: true, data: document });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @route   PUT /:id/sub-document/:subId/ncr-approve
// @desc    PMC approves compliance for sub-document
// @access  Private
router.put('/:id/sub-document/:subId/ncr-approve', protect, async (req, res) => {
  try {
    const document = await GeneralDocument.findById(req.params.id);
    if (!document) return res.status(404).json({ success: false, message: 'Document not found' });
    const subDoc = document.subDocuments.id(req.params.subId);
    if (!subDoc) return res.status(404).json({ success: false, message: 'Sub-document not found' });

    const approverName = req.user.name || req.user.userId || 'PMC';
    subDoc.ncApprovedCompliance = true;
    subDoc.ncApprovedBy = approverName;
    subDoc.ncApprovedAt = new Date();
    subDoc.ncStatus = 'NC Removed';
    subDoc.approvalStatus = 'Approved';
    await document.save();
    res.status(200).json({ success: true, data: document });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
