const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

// Connect to MongoDB
const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/pmis_db';

mongoose.connect(mongoURI)
  .then(async () => {
    console.log('MongoDB connected successfully');
    
    // Import models
    const GeneralFolder = require('../models/GeneralFolder');
    const GeneralDocument = require('../models/GeneralDocument');
    
    // Find documents in other sections to delete physical files
    const docs = await GeneralDocument.find({ section: { $ne: 'tender' } });
    console.log(`Found ${docs.length} documents in non-tender sections to delete.`);
    
    for (const doc of docs) {
      if (doc.filePath && fs.existsSync(doc.filePath)) {
        try {
          fs.unlinkSync(doc.filePath);
          console.log(`Deleted file: ${doc.filePath}`);
        } catch (err) {
          console.error(`Error deleting file ${doc.filePath}:`, err);
        }
      }
    }
    
    // Delete document records
    const deleteDocsRes = await GeneralDocument.deleteMany({ section: { $ne: 'tender' } });
    console.log(`Deleted ${deleteDocsRes.deletedCount} document records from MongoDB.`);
    
    // Delete folders in other sections
    const deleteFoldersRes = await GeneralFolder.deleteMany({ section: { $ne: 'tender' } });
    console.log(`Deleted ${deleteFoldersRes.deletedCount} folders from MongoDB for non-tender sections.`);
    
    mongoose.disconnect();
    console.log('Done.');
  })
  .catch(err => {
    console.error('Database connection error:', err);
  });
