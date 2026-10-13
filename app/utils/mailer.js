const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_SECURE } = process.env;
  if (!SMTP_HOST || !SMTP_PORT) {
    throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD in .env');
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: SMTP_SECURE === 'true', // true for port 465, false for 587/25 (STARTTLS)
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASSWORD } : undefined
  });
  return transporter;
}

async function sendContactEmail({ firstName, lastName, email, message }) {
  const to = process.env.CONTACT_TO_EMAIL;
  const from = process.env.CONTACT_FROM_EMAIL || process.env.SMTP_USER;
  if (!to) throw new Error('CONTACT_TO_EMAIL is not set in .env');

  const t = getTransporter();
  await t.sendMail({
    from,
    to,
    replyTo: email,
    subject: `[PENOKS Contact Form] Message from ${firstName} ${lastName}`,
    text: `From: ${firstName} ${lastName} <${email}>\n\n${message || '(no message provided)'}`,
    html: `<p><strong>From:</strong> ${escapeHtml(firstName)} ${escapeHtml(lastName)} &lt;${escapeHtml(email)}&gt;</p>
           <p>${escapeHtml(message || '(no message provided)').replace(/\n/g, '<br>')}</p>`
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function sendPasswordResetEmail({ to, fullName, memberId, resetLink }) {
  const from = process.env.CONTACT_FROM_EMAIL || process.env.SMTP_USER;
  const t = getTransporter();
  await t.sendMail({
    from,
    to,
    subject: 'Reset your PENOKS member portal password',
    text:
`Hello ${fullName},

An administrator has sent you a link to reset your PENOKS Neighborhood Friends portal password.

Your Member ID: ${memberId}

Set a new password here (the link works once and expires in 1 hour):
${resetLink}

If you were not expecting this email you can ignore it; your current password will keep working until you use the link.`,
    html:
`<p>Hello ${escapeHtml(fullName)},</p>
<p>An administrator has sent you a link to reset your PENOKS Neighborhood Friends portal password.</p>
<p><strong>Your Member ID:</strong> ${escapeHtml(memberId)}</p>
<p><a href="${escapeHtml(resetLink)}">Set a new password</a><br>
<small>The link works once and expires in 1 hour.</small></p>
<p><small>If you were not expecting this email you can ignore it; your current password will keep working until you use the link.</small></p>`
  });
}

module.exports = { sendContactEmail, sendPasswordResetEmail };
