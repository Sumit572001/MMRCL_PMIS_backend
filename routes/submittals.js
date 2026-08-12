const express = require('express');
const router = express.Router();
const SubmittalMatrix = require('../models/SubmittalMatrix');
const Document = require('../models/Document');
const { protect } = require('../middleware/auth');

// @desc    Get all submittal matrix items with counts of uploaded documents
// @route   GET /api/submittals
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const submittals = await SubmittalMatrix.find().sort({ code: 1 });

    // Aggregate document counts grouped by submittalMatrixId
    const docCounts = await Document.aggregate([
      {
        $group: {
          _id: '$submittalMatrixId',
          totalDocs: { $sum: 1 },
          pendingDocs: {
            $sum: {
              $cond: [{ $eq: ['$status', 'Pending Engineer Review'] }, 1, 0]
            }
          },
          approvedDocs: {
            $sum: {
              $cond: [{ $in: ['$status', ['Employer Approved', 'Approved with Comments']] }, 1, 0]
            }
          },
          commentsIssuedDocs: {
            $sum: {
              $cond: [{ $eq: ['$status', 'Engineer Reviewed - Comments Issued'] }, 1, 0]
            }
          }
        }
      }
    ]);

    // Map aggregate stats onto the matrix items
    const statsMap = docCounts.reduce((acc, current) => {
      acc[current._id.toString()] = {
        total: current.totalDocs,
        pending: current.pendingDocs,
        approved: current.approvedDocs,
        commentsIssued: current.commentsIssuedDocs
      };
      return acc;
    }, {});

    const matrixWithStats = submittals.map(item => {
      const stats = statsMap[item._id.toString()] || { total: 0, pending: 0, approved: 0, commentsIssued: 0 };
      return {
        ...item.toObject(),
        stats
      };
    });

    res.status(200).json({
      success: true,
      count: matrixWithStats.length,
      data: matrixWithStats
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Get dashboard statistics summary
// @route   GET /api/submittals/stats
// @access  Private
router.get('/stats', protect, async (req, res) => {
  try {
    const totalMatrixCount = await SubmittalMatrix.countDocuments();
    const totalDocs = await Document.countDocuments();
    const pendingDocs = await Document.countDocuments({ status: 'Pending Engineer Review' });
    const commentsIssued = await Document.countDocuments({ status: 'Engineer Reviewed - Comments Issued' });
    const employerApproved = await Document.countDocuments({ status: { $in: ['Employer Approved', 'Approved with Comments'] } });
    const transmittedDocs = await Document.countDocuments({ status: 'Transmitted to Employer' });

    res.status(200).json({
      success: true,
      data: {
        totalMatrixCount,
        totalDocs,
        pendingDocs,
        commentsIssued,
        employerApproved,
        transmittedDocs
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Create a new custom submittal matrix item
// @route   POST /api/submittals
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    const { code, name, paperCopies, electronicCopies, reference } = req.body;

    const submittal = await SubmittalMatrix.create({
      code,
      name,
      paperCopies,
      electronicCopies,
      reference
    });

    res.status(201).json({
      success: true,
      data: submittal
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
