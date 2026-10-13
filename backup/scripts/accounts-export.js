const path = require('path');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const { uploadFile } = require('./drive');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

function timestamp() {
  return new Date().toISOString().slice(0, 10);
}

async function buildWorkbook() {
  const { rows } = await pool.query(`
    SELECT a.entry_id, to_char(a.txn_date,'YYYY-MM-DD') AS txn_date, a.entry_type, a.source_type, a.source_id,
           a.member_id, m.full_name AS member_name, a.amount, a.description, a.status
    FROM accounts a
    LEFT JOIN members m ON m.member_id = a.member_id
    ORDER BY a.txn_date ASC, a.created_at ASC
  `);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Accounts Ledger');

  sheet.columns = [
    { header: 'Entry ID', key: 'entry_id', width: 10 },
    { header: 'Date', key: 'txn_date', width: 14 },
    { header: 'Type', key: 'entry_type', width: 10 },
    { header: 'Source Type', key: 'source_type', width: 12 },
    { header: 'Source ID', key: 'source_id', width: 14 },
    { header: 'Member ID', key: 'member_id', width: 12 },
    { header: 'Member Name', key: 'member_name', width: 24 },
    { header: 'Amount (₦)', key: 'amount', width: 14 },
    { header: 'Description', key: 'description', width: 30 },
    { header: 'Status', key: 'status', width: 10 }
  ];
  sheet.getRow(1).font = { bold: true };

  let runningBalance = 0;
  rows.forEach((r) => {
    if (r.status === 'posted') {
      runningBalance += r.entry_type === 'credit' ? Number(r.amount) : -Number(r.amount);
    }
    sheet.addRow({ ...r, amount: Number(r.amount) });
  });

  const summarySheet = workbook.addWorksheet('Summary');
  const totalCredit = rows.filter(r => r.entry_type === 'credit' && r.status === 'posted')
    .reduce((s, r) => s + Number(r.amount), 0);
  const totalDebit = rows.filter(r => r.entry_type === 'debit' && r.status === 'posted')
    .reduce((s, r) => s + Number(r.amount), 0);
  summarySheet.addRows([
    ['Total Credits (Payments) ₦', totalCredit],
    ['Total Debits (Expenses) ₦', totalDebit],
    ['Club Balance ₦', totalCredit - totalDebit],
    ['Generated At', new Date().toISOString()]
  ]);
  summarySheet.getColumn(1).width = 30;

  return workbook;
}

async function runAccountsExport() {
  console.log('[accounts-export] Building workbook from accounts table...');
  const workbook = await buildWorkbook();
  const fileName = `penoks-accounts-${timestamp()}.xlsx`;
  const outFile = path.join('/tmp/penoks-backup', fileName);
  await workbook.xlsx.writeFile(outFile);
  console.log(`[accounts-export] Workbook written to ${outFile}, uploading as a Google Sheet...`);
  await uploadFile({
    localPath: outFile,
    name: fileName.replace(/\.xlsx$/, ''),
    sourceMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    targetMimeType: 'application/vnd.google-apps.spreadsheet'
  });
  console.log('[accounts-export] Done.');
}

module.exports = { runAccountsExport };

if (require.main === module) {
  runAccountsExport()
    .then(() => pool.end())
    .catch((err) => { console.error('[accounts-export] FAILED:', err); pool.end(); process.exit(1); });
}
