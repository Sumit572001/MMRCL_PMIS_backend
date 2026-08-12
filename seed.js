require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const SubmittalMatrix = require('./models/SubmittalMatrix');

const submittalsData = [
  {
    code: 'MMRCL-SUB-01',
    name: 'Initial Program and Works Program plus supporting information and narrative',
    paperCopies: { A1: 0, A3: 3, A4: 0 },
    electronicCopies: 2,
    reference: ''
  },
  {
    code: 'MMRCL-SUB-02',
    name: 'Monthly Program Update',
    paperCopies: { A1: 0, A3: 3, A4: 0 },
    electronicCopies: 2,
    reference: ''
  },
  {
    code: 'MMRCL-SUB-03',
    name: 'Three Month Rolling Program',
    paperCopies: { A1: 0, A3: 3, A4: 0 },
    electronicCopies: 2,
    reference: ''
  },
  {
    code: 'MMRCL-SUB-04',
    name: 'Three Week Rolling Program',
    paperCopies: { A1: 0, A3: 3, A4: 0 },
    electronicCopies: 2,
    reference: ''
  },
  {
    code: 'MMRCL-SUB-05',
    name: 'Monthly Progress Report',
    paperCopies: { A1: 0, A3: 0, A4: 3 },
    electronicCopies: 2,
    reference: ''
  },
  {
    code: 'MMRCL-SUB-06',
    name: 'Construction Reference Drawings',
    paperCopies: { A1: 3, A3: 3, A4: 0 },
    electronicCopies: 2,
    reference: ''
  },
  {
    code: 'MMRCL-SUB-07',
    name: 'Works Drawings',
    paperCopies: { A1: 3, A3: 3, A4: 0 },
    electronicCopies: 2,
    reference: ''
  },
  {
    code: 'MMRCL-SUB-08',
    name: 'Method Statements',
    paperCopies: { A1: 0, A3: 0, A4: 3 },
    electronicCopies: 2,
    reference: ''
  },
  {
    code: 'MMRCL-SUB-09',
    name: 'Interface Management Plan',
    paperCopies: { A1: 0, A3: 0, A4: 0 },
    electronicCopies: 2,
    reference: ''
  },
  {
    code: 'MMRCL-SUB-10',
    name: 'As built drawings',
    paperCopies: { A1: 3, A3: 0, A4: 0 },
    electronicCopies: 2,
    reference: ''
  },
  {
    code: 'MMRCL-SUB-11',
    name: 'Materials Submissions (documentation)',
    paperCopies: { A1: 0, A3: 0, A4: 3 },
    electronicCopies: 0,
    reference: ''
  },
  {
    code: 'MMRCL-SUB-12',
    name: 'Operation and Maintenance Manuals',
    paperCopies: { A1: 0, A3: 0, A4: 3 },
    electronicCopies: 2,
    reference: ''
  },
  {
    code: 'MMRCL-SUB-13',
    name: 'E & M Submissions',
    paperCopies: { A1: 0, A3: 0, A4: 3 },
    electronicCopies: 2,
    reference: ''
  },
  {
    code: 'MMRCL-SUB-14',
    name: 'Quality Plan',
    paperCopies: { A1: 0, A3: 0, A4: 3 },
    electronicCopies: 2,
    reference: ''
  },
  {
    code: 'MMRCL-SUB-15',
    name: 'Quality Control Register',
    paperCopies: { A1: 0, A3: 0, A4: 3 },
    electronicCopies: 2,
    reference: ''
  },
  {
    code: 'MMRCL-SUB-16',
    name: 'Reports of Quarterly Quality Audits',
    paperCopies: { A1: 0, A3: 0, A4: 3 },
    electronicCopies: 2,
    reference: ''
  },
  {
    code: 'MMRCL-SUB-17',
    name: 'Safety Plan',
    paperCopies: { A1: 0, A3: 0, A4: 3 },
    electronicCopies: 2,
    reference: ''
  },
  {
    code: 'MMRCL-SUB-18',
    name: 'Environment Plan',
    paperCopies: { A1: 0, A3: 0, A4: 3 },
    electronicCopies: 2,
    reference: ''
  },
  {
    code: 'MMRCL-SUB-19',
    name: 'Materials and Workmanship Test Results/Reports',
    paperCopies: { A1: 0, A3: 0, A4: 3 },
    electronicCopies: 2,
    reference: ''
  },
  {
    code: 'MMRCL-SUB-20',
    name: 'Investigation and survey reports',
    paperCopies: { A1: 0, A3: 0, A4: 3 },
    electronicCopies: 2,
    reference: ''
  },
  {
    code: 'MMRCL-SUB-21',
    name: 'Monitoring, protection and replacement proposal reports.',
    paperCopies: { A1: 0, A3: 0, A4: 3 },
    electronicCopies: 2,
    reference: ''
  },
  {
    code: 'MMRCL-SUB-22',
    name: 'All other submittals',
    paperCopies: { A1: 3, A3: 3, A4: 3 },
    electronicCopies: 2,
    reference: 'As applicable'
  }
];

const usersData = [
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
  },
  {
    name: 'Employer Rep',
    userId: 'EMPLOYER',
    email: 'employer@pmis.com',
    password: 'password123',
    role: "Employer's Office",
    organization: 'MMRCL Employer Office (Main)'
  }
];

const seedDB = async () => {
  try {
    const connStr = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pmis';
    console.log(`Connecting to database for seeding: ${connStr}...`);
    await mongoose.connect(connStr);
    console.log('Database connected.');

    // Clear existing data
    console.log('Clearing old matrix definitions and default users...');
    await SubmittalMatrix.deleteMany();
    console.log('Cleared SubmittalMatrix collection.');

    // We clear users that match userEmails or userIds
    const userEmails = usersData.map(u => u.email);
    const userIds = usersData.map(u => u.userId);
    await User.deleteMany({ $or: [{ email: { $in: userEmails } }, { userId: { $in: userIds } }] });
    console.log('Cleared default seeded users.');

    // Insert submittals
    console.log('Seeding submittal matrix data...');
    await SubmittalMatrix.insertMany(submittalsData);
    console.log('Successfully seeded Submittal Matrix!');

    // Insert users
    console.log('Seeding default role-based users...');
    for (const u of usersData) {
      await User.create(u);
    }
    console.log('Successfully seeded default users!');

    console.log('Seeding completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error during seeding:', error);
    process.exit(1);
  }
};

seedDB();
