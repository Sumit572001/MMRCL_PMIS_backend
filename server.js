require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const connectDB = require('./config/db');

// Connect to Database
connectDB();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create uploads directory if it doesn't exist
const uploadDir = process.env.UPLOAD_DIR || 'uploads';
const uploadPath = path.join(__dirname, uploadDir);
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

// Ensure building images are copied to uploads directory
try {
  const userHome = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\Sumit Verma';
  const brainDir = path.join(userHome, '.gemini', 'antigravity-ide', 'brain', '4a096d0c-db9d-485c-a760-a14a8aa77b43');

  const originalImg = path.join(brainDir, 'media__1786338713542.jpg');
  if (fs.existsSync(originalImg)) {
    fs.copyFileSync(originalImg, path.join(uploadPath, 'metro_bhawan.jpg'));
  }

  const generatedImg = path.join(brainDir, 'metro_bhawan_building_1786340065521.png');
  if (fs.existsSync(generatedImg)) {
    fs.copyFileSync(generatedImg, path.join(uploadPath, 'metro_bhawan_building.png'));
  }
} catch (e) {
  console.log('Building image copy notice:', e.message);
}

// Serve uploaded files statically
app.use('/uploads', express.static(uploadPath));

// Mount Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/submittals', require('./routes/submittals'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/share', require('./routes/share'));
app.use('/api/tender', (req, res, next) => {
  req.section = 'tender';
  next();
}, require('./routes/generalDocs'));

app.use('/api/contractual', (req, res, next) => {
  req.section = 'contractual';
  next();
}, require('./routes/generalDocs'));

app.use('/api/monitor', (req, res, next) => {
  req.section = 'project monitoring & control';
  next();
}, require('./routes/generalDocs'));

app.use('/api/drawing', (req, res, next) => {
  req.section = 'project drawings';
  next();
}, require('./routes/generalDocs'));

app.use('/api/quality', (req, res, next) => {
  req.section = 'quality management';
  next();
}, require('./routes/generalDocs'));

app.use('/api/ehs', (req, res, next) => {
  req.section = 'environment, health, and safety (ehs)';
  next();
}, require('./routes/generalDocs'));

app.use('/api/mep', (req, res, next) => {
  req.section = 'mep';
  next();
}, require('./routes/generalDocs'));

app.use('/api/registrations', (req, res, next) => {
  req.section = 'project documents & registration';
  next();
}, require('./routes/generalDocs'));

// Basic health check route
app.get('/api/health', (req, res) => {
  res.status(200).json({ success: true, message: 'PMIS API Server is healthy' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server Error:', err.stack);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Server Error. Please contact admin.'
  });
});

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`PMIS Backend Server running on port ${PORT}`);
});

process.on('unhandledRejection', (err, promise) => {
  console.error(`Error: ${err.message}`);
  // Close server & exit process
  server.close(() => process.exit(1));
});
