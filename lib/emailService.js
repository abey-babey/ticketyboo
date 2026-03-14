// ─── Ethereal email service ───────────────────────────────────────────────────
// Uses Nodemailer with an auto-provisioned Ethereal (fake SMTP) account.
// All emails are captured at https://ethereal.email/messages — nothing is
// delivered to real inboxes.  Each run creates a fresh throwaway account.

const nodemailer = require('nodemailer');

let transporter = null;

async function initEmailTransport() {
  try {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host:   'smtp.ethereal.email',
      port:   587,
      secure: false,
      auth:   { user: testAccount.user, pass: testAccount.pass }
    });
    console.log('\n📧 Ethereal email ready — captured emails appear at:');
    console.log('   https://ethereal.email/messages');
    console.log('   Inbox: ' + testAccount.user + '\n');
  } catch (err) {
    console.warn('⚠️  Could not initialise Ethereal transport:', err.message);
  }
}

/**
 * Send an email via Ethereal.
 * @param {object} opts
 * @param {string} opts.to      Recipient email address
 * @param {string} opts.subject Email subject
 * @param {string} opts.html    HTML body
 * @returns {Promise<string|null>} Ethereal preview URL, or null on failure
 */
async function sendEmail({ to, subject, html }) {
  if (!transporter) throw new Error('Email transport not initialised');
  const info = await transporter.sendMail({
    from: '"Ticketyboo" <no-reply@ticketyboo.example>',
    to,
    subject,
    html
  });
  return nodemailer.getTestMessageUrl(info);
}

module.exports = { initEmailTransport, sendEmail };
