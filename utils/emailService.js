const nodemailer = require('nodemailer');
const User = require('../models/User');

// Fallback recipient list containing all 14 official email addresses
const DEFAULT_RECIPIENTS = [
  'md.aasim@mmrcl.com',
  'rajesh.patil@mmrcl.com',
  'sachin.aher@mmrcl.com',
  'vikrant.tewathia@mmrcl.com',
  'vishwas.ajnalkar@mmrcl.com',
  'ashish.saxena@mmrcl.com',
  'neha.bhoi@mmrcl.com',
  'rajeev.kumar@mmrcl.com',
  'sudhir.sahare@mmrcl.com',
  'Rutesh.Jadhav@mmrcl.com',
  'sumit.patil@mmrcl.com',
  'arch.mmrcl@gmail.com',
  'pmc.mmrcl@gmail.com',
  'coordination.mmrcl@nyatigroup.com'
];

/**
 * Creates Nodemailer Transporter using environment variables
 * Supports Gmail (port 465) and Outlook / Office 365 (port 587)
 */
const createTransporter = () => {
  const user = process.env.EMAIL_USER || 'coordination.mmrcl@nyatigroup.com';
  const pass = process.env.EMAIL_PASS || '';

  let host = process.env.EMAIL_HOST;
  let port = parseInt(process.env.EMAIL_PORT || '', 10);

  // Auto-detect host and port based on email domain if not explicitly provided
  if (!host) {
    if (user.includes('nyatigroup.com') || user.includes('outlook') || user.includes('office365') || user.includes('hotmail')) {
      host = 'smtp.office365.com';
      port = port || 587;
    } else {
      host = 'smtp.gmail.com';
      port = port || 465;
    }
  }

  if (!port) {
    port = host.includes('office365') || host.includes('outlook') ? 587 : 465;
  }

  const isSecure = port === 465;

  if (!pass) {
    console.log('[EmailTrigger Notice] EMAIL_PASS is not configured in .env yet. Email notifications are logged to console.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: isSecure, // true for 465, false for 587 (STARTTLS)
    auth: {
      user,
      pass
    },
    tls: {
      ciphers: 'SSLv3',
      rejectUnauthorized: false
    }
  });
};

/**
 * Sends an automated HTML email notification to all 14 registered users upon document upload
 */
const notifyNewDocumentUpload = async ({
  uploaderName = 'PMIS User',
  docName = 'Untitled Document',
  sectionName = 'General Documents',
  folderName = 'Root',
  originalFileName = '',
  uploadedAt = new Date()
}) => {
  try {
    // Collect all registered email addresses from Database
    let recipientEmails = [...DEFAULT_RECIPIENTS];
    try {
      const dbUsers = await User.find({}, 'email');
      const dbEmails = dbUsers.map(u => u.email).filter(e => e && e.includes('@'));
      recipientEmails = Array.from(new Set([...recipientEmails, ...dbEmails]));
    } catch (dbErr) {
      console.warn('[EmailTrigger] Could not fetch DB emails, using fallback list:', dbErr.message);
    }

    const senderUser = process.env.EMAIL_USER || 'arch.mmrcl@gmail.com';
    const emailPass = process.env.EMAIL_PASS || '';

    const formattedTime = new Date(uploadedAt).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    const emailSubject = `[PMIS Notification] New Document Uploaded: ${docName}`;

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9; margin: 0; padding: 20px; color: #1e293b; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; }
        .header { background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); padding: 24px 30px; text-align: center; color: #ffffff; }
        .header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
        .header p { margin: 4px 0 0 0; font-size: 13px; opacity: 0.9; }
        .body-content { padding: 30px; }
        .alert-badge { display: inline-block; background-color: #e0f2fe; color: #0369a1; font-weight: 700; font-size: 12px; padding: 6px 14px; border-radius: 20px; text-transform: uppercase; margin-bottom: 20px; }
        .details-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
        .details-table td { padding: 12px 14px; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
        .details-table td.label { font-weight: 600; color: #64748b; width: 35%; }
        .details-table td.value { font-weight: 700; color: #0f172a; }
        .footer { background: #f8fafc; padding: 16px 30px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>MMRCL PMIS Portal</h1>
          <p>Metro Bhawan & Staff Quarters Construction Project</p>
        </div>
        <div class="body-content">
          <div class="alert-badge">📄 New Document Uploaded</div>
          <p style="font-size: 15px; margin-bottom: 20px;">
            Hello Team,<br>
            A new document has been recently uploaded on the <strong>PMIS Portal</strong>.
          </p>
          
          <table class="details-table">
            <tr>
              <td class="label">Document Title</td>
              <td class="value">${docName}</td>
            </tr>
            <tr>
              <td class="label">Section / Module</td>
              <td class="value" style="text-transform: capitalize;">${sectionName}</td>
            </tr>
            <tr>
              <td class="label">Folder</td>
              <td class="value">${folderName}</td>
            </tr>
            ${originalFileName ? `
            <tr>
              <td class="label">File Name</td>
              <td class="value">${originalFileName}</td>
            </tr>` : ''}
            <tr>
              <td class="label">Uploaded By</td>
              <td class="value" style="color: #0284c7;">${uploaderName}</td>
            </tr>
            <tr>
              <td class="label">Date & Time</td>
              <td class="value">${formattedTime}</td>
            </tr>
          </table>

          <p style="font-size: 13px; color: #64748b; line-height: 1.5;">
            Please log in to the PMIS Portal to view, download, or review this document.
          </p>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} Mumbai Metro Rail Corporation Limited (MMRCL) • PMIS Portal Notification System
        </div>
      </div>
    </body>
    </html>
    `;

    console.log(`[EmailTrigger] Dispatching email to ${recipientEmails.length} recipients for doc: "${docName}" uploaded by "${uploaderName}"`);

    if (!emailPass) {
      console.log(`[EmailTrigger Notification Preview]
To: ${recipientEmails.join(', ')}
Subject: ${emailSubject}
Body: Uploaded by ${uploaderName} -> ${docName} (${sectionName} / ${folderName})
(Skipping SMTP transport since EMAIL_PASS is not provided yet)`);
      return { success: true, simulated: true };
    }

    const transporter = createTransporter();

    const mailOptions = {
      from: `"MMRCL PMIS Portal" <${senderUser}>`,
      to: recipientEmails.join(', '),
      subject: emailSubject,
      html: htmlContent
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[EmailTrigger] Email sent successfully! MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };

  } catch (error) {
    console.error('[EmailTrigger Error] Failed to dispatch email notification:', error.message);
    // Return gracefully so main document upload API endpoint is NEVER interrupted
    return { success: false, error: error.message };
  }
};

module.exports = {
  notifyNewDocumentUpload,
  DEFAULT_RECIPIENTS
};
