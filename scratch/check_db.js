const mongoose = require('mongoose');
const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/pmis_db';
mongoose.connect(mongoURI).then(async () => {
  const GeneralDocument = require('../models/GeneralDocument');
  const GeneralFolder = require('../models/GeneralFolder');
  const ActivityLog = require('../models/ActivityLog');
  
  const allDocs = await GeneralDocument.find({}).lean();
  console.log('Total GeneralDocuments:', allDocs.length);
  const docsBySec = {};
  allDocs.forEach(d => {
    docsBySec[d.section] = (docsBySec[d.section] || 0) + 1;
  });
  console.log('Docs by section:', docsBySec);

  const allFolders = await GeneralFolder.find({}).lean();
  console.log('Total GeneralFolders:', allFolders.length);
  const foldersBySec = {};
  allFolders.forEach(f => {
    foldersBySec[f.section] = (foldersBySec[f.section] || 0) + 1;
  });
  console.log('Folders by section:', foldersBySec);

  const logsCount = await ActivityLog.countDocuments();
  console.log('Total ActivityLogs:', logsCount);
  const recentLogs = await ActivityLog.find({}).sort({ timestamp: -1 }).limit(10).lean();
  console.log('Recent 10 logs:', recentLogs.map(l => ({ action: l.action, details: l.details, entityType: l.entityType, entityName: l.entityName, section: l.section, timestamp: l.timestamp })));

  mongoose.disconnect();
}).catch(console.error);
