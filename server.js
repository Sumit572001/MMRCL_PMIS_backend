require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const connectDB = require('./config/db');
const User = require('./models/User');

// Connect to Database and ensure default accounts exist
connectDB().then(async () => {
  try {
    const defaultUsers = [
      {
        name: 'NECPL',
        userId: 'NECPL',
        email: 'necpl@pmis.com',
        password: 'Necpl@2026',
        role: 'Site Engineer',
        organization: 'NECPL Site Office'
      },
      {
        name: 'MMRCL',
        userId: 'MMRCL',
        email: 'mmrcl@pmis.com',
        password: 'Mmrcl@2026',
        role: 'Contractor',
        organization: 'MMRCL Employer Office'
      },
      {
        name: 'PMC & Architect',
        userId: 'PMC',
        email: 'pmc@pmis.com',
        password: 'Pmc@2026',
        role: 'Contractor',
        organization: 'PMC & Architect Office'
      },
      {
        name: 'Contractor',
        userId: 'CONTRACTOR',
        email: 'contractor@pmis.com',
        password: 'password123',
        role: 'Contractor',
        organization: 'L&T Construction MMRCL JV'
      },
      {
        name: 'Engineer',
        userId: 'ENGINEER',
        email: 'engineer@pmis.com',
        password: 'password123',
        role: 'Site Engineer',
        organization: 'MMRCL General Consultant Site Office'
      }
    ];

    for (const u of defaultUsers) {
      const existing = await User.findOne({
        $or: [{ userId: u.userId }, { email: u.email }]
      });
      if (!existing) {
        await User.create(u);
        console.log(`[AutoSeed] Created account for ${u.userId}`);
      } else {
        existing.userId = u.userId;
        existing.role = u.role;
        existing.organization = u.organization;
        existing.name = u.name;
        existing.password = u.password;
        await existing.save();
        console.log(`[AutoSeed] Synced account for ${u.userId}`);
      }
    }
  } catch (err) {
    console.error('[AutoSeed] Error initializing users:', err.message);
  }
});

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

// Ensure building image exist in uploads directory if missing
try {
  const userHome = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\Sumit Verma';
  const currentMediaImg = path.join(userHome, '.gemini', 'antigravity-ide', 'brain', 'd918d6f0-235b-4815-9068-47ccd74b9959', 'media__1786973200429.png');
  const targetImg = path.join(uploadPath, 'metro_bhawan.jpg');
  const targetPng = path.join(uploadPath, 'metro_bhawan_building.png');

  if (fs.existsSync(currentMediaImg)) {
    fs.copyFileSync(currentMediaImg, targetImg);
    fs.copyFileSync(currentMediaImg, targetPng);
  }
} catch (e) {
  console.log('Building image sync notice:', e.message);
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
