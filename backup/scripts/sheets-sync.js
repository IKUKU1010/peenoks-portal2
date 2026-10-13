// Mirrors key tables into a Google Sheet (one tab per table) so that no-code tools
// (Zapier, Make, n8n, Airtable sync, Apps Script...) can trigger messages from the data.
//
// Direction is ONE WAY: database -> sheet. Edits made in the sheet are overwritten on
// the next sync and never written back to the database.
//
// Deliberately NOT copied: password hashes, reset tokens, home addresses, uploaded files.
const fs = require('fs');
const { Pool } = require('pg');
const { google } = require('googleapis');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const iso = (v) => (v ? new Date(v).toISOString() : '');
const num = (v) => (v === null || v === undefined ? '' : Number(v));

// Rows are ordered oldest -> newest so that NEW records are appended at the bottom
// (this is what "new row" triggers in Zapier/Make rely on).
async function buildTables() {
  const members = await pool.query(`
    SELECT member_id, full_name, phone, email, birth_month, birth_day, status,
           to_char(joined_at,'YYYY-MM-DD') AS joined
    FROM members ORDER BY joined_at ASC, member_id ASC`);

  const applicants = await pool.query(`
    SELECT applicant_id, full_name, phone, email, status, created_at, approved_member_id
    FROM applicants ORDER BY created_at ASC, applicant_id ASC`);

  const payments = await pool.query(`
    SELECT p.payment_id, p.member_id, m.full_name AS member_name, m.phone, m.email,
           p.purpose, p.amount, to_char(p.payment_date,'YYYY-MM-DD') AS payment_date,
           p.status, p.created_at, p.reviewed_at
    FROM payments p LEFT JOIN members m ON m.member_id = p.member_id
    ORDER BY p.created_at ASC, p.payment_id ASC`);

  const expenses = await pool.query(`
    SELECT e.expense_id, e.member_id, m.full_name AS member_name,
           e.purpose, e.amount, to_char(e.expense_date,'YYYY-MM-DD') AS expense_date,
           e.status, e.created_at, e.reviewed_at
    FROM expenses e LEFT JOIN members m ON m.member_id = e.member_id
    ORDER BY e.created_at ASC, e.expense_id ASC`);

  const accounts = await pool.query(`
    SELECT a.entry_id, to_char(a.txn_date,'YYYY-MM-DD') AS txn_date, a.entry_type,
           a.source_type, a.source_id, a.member_id, m.full_name AS member_name,
           a.amount, a.description, a.status
    FROM accounts a LEFT JOIN members m ON m.member_id = a.member_id
    ORDER BY a.txn_date ASC, a.entry_id ASC`);

  return [
    {
      tab: 'Members',
      header: ['Member ID', 'Full Name', 'Phone', 'Email', 'Birth Month', 'Birth Day', 'Birthday (MM-DD)', 'Birthday (text)', 'Status', 'Joined'],
      rows: members.rows.map((r) => [
        r.member_id, r.full_name, r.phone || '', r.email || '',
        r.birth_month || '', r.birth_day || '',
        r.birth_month && r.birth_day ? `${String(r.birth_month).padStart(2, '0')}-${String(r.birth_day).padStart(2, '0')}` : '',
        r.birth_month && r.birth_day ? `${MONTHS[r.birth_month]} ${r.birth_day}` : '',
        r.status, r.joined
      ])
    },
    {
      tab: 'Applicants',
      header: ['Applicant ID', 'Full Name', 'Phone', 'Email', 'Status', 'Submitted At (UTC)', 'Member ID (if approved)'],
      rows: applicants.rows.map((r) => [r.applicant_id, r.full_name, r.phone || '', r.email || '', r.status, iso(r.created_at), r.approved_member_id || ''])
    },
    {
      tab: 'Payments',
      header: ['Payment ID', 'Member ID', 'Member Name', 'Phone', 'Email', 'Purpose', 'Amount (NGN)', 'Payment Date', 'Status', 'Submitted At (UTC)', 'Reviewed At (UTC)'],
      rows: payments.rows.map((r) => [r.payment_id, r.member_id, r.member_name || '', r.phone || '', r.email || '', r.purpose, num(r.amount), r.payment_date, r.status, iso(r.created_at), iso(r.reviewed_at)])
    },
    {
      tab: 'Expenses',
      header: ['Expense ID', 'Member ID', 'Member Name', 'Purpose', 'Amount (NGN)', 'Expense Date', 'Status', 'Submitted At (UTC)', 'Reviewed At (UTC)'],
      rows: expenses.rows.map((r) => [r.expense_id, r.member_id, r.member_name || '', r.purpose, num(r.amount), r.expense_date, r.status, iso(r.created_at), iso(r.reviewed_at)])
    },
    {
      tab: 'Accounts',
      header: ['Entry ID', 'Date', 'Type', 'Source Type', 'Source ID', 'Member ID', 'Member Name', 'Amount (NGN)', 'Description', 'Status'],
      rows: accounts.rows.map((r) => [r.entry_id, r.txn_date, r.entry_type, r.source_type, r.source_id, r.member_id || '', r.member_name || '', num(r.amount), r.description || '', r.status])
    }
  ];
}

function getSheetsClient() {
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyFile || !fs.existsSync(keyFile)) {
    throw new Error(`Google service account key not found at ${keyFile}.`);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({ version: 'v4', auth });
}

async function runSheetsSync() {
  const spreadsheetId = process.env.GSHEET_ID;
  const tables = await buildTables();

  if (process.env.DRY_RUN === 'true' || !spreadsheetId) {
    console.log(`[sheets-sync] ${spreadsheetId ? 'DRY RUN' : 'GSHEET_ID not set - nothing uploaded'}. Would sync:`);
    tables.forEach((t) => console.log(`  - ${t.tab}: ${t.rows.length} row(s), ${t.header.length} column(s)`));
    return;
  }

  const sheets = getSheetsClient();

  // Make sure every tab exists
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  const existing = new Set(meta.data.sheets.map((s) => s.properties.title));
  const wanted = [...tables.map((t) => t.tab), 'Sync Info'];
  const toAdd = wanted.filter((t) => !existing.has(t));
  if (toAdd.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: toAdd.map((title) => ({ addSheet: { properties: { title } } })) }
    });
  }

  for (const t of tables) {
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${t.tab}'` });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${t.tab}'!A1`,
      valueInputOption: 'RAW', // RAW keeps phone numbers like 0803... as text
      requestBody: { values: [t.header, ...t.rows] }
    });
    console.log(`[sheets-sync] ${t.tab}: ${t.rows.length} row(s)`);
  }

  await sheets.spreadsheets.values.clear({ spreadsheetId, range: "'Sync Info'" });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "'Sync Info'!A1",
    valueInputOption: 'RAW',
    requestBody: {
      values: [
        ['Last synced (UTC)', new Date().toISOString()],
        ['Direction', 'Database -> Sheet (one way). Edits here are overwritten on the next sync.']
      ]
    }
  });
  console.log('[sheets-sync] Done.');
}

module.exports = { runSheetsSync, buildTables };

if (require.main === module) {
  runSheetsSync()
    .then(() => pool.end())
    .catch((err) => { console.error('[sheets-sync] FAILED:', err.message); pool.end(); process.exit(1); });
}
