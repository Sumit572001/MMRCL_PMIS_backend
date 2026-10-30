const mongoose = require('mongoose');
const mongoURI = 'mongodb://127.0.0.1:27017/pmis';
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

  console.log('Sample docs:');
  allDocs.slice(0, 10).forEach(d => {
    console.log({ id: d._id, name: d.name, originalName: d.originalName, section: d.section, folder: d.folder, category: d.category });
  });

  console.log('Sample folders:');
  allFolders.slice(0, 15).forEach(f => {
    console.log({ id: f._id, name: f.name, section: f.section, parentFolder: f.parentFolder, category: f.category });
  });

  mongoose.disconnect();
}).catch(console.error);
