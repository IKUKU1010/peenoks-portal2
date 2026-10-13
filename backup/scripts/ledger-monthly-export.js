// Monthly ledger export -> CSV file (no Google APIs involved).
//
// Runs from index.js at 00:00 on the 1st of every month (see LEDGER_EXPORT_CRON /
// LEDGER_EXPORT_TZ) and exports every ledger entry whose transaction date falls in the
// month that just ended. Files are written to LEDGER_EXPORT_DIR (a shared Docker volume)
// as  penoks-ledger-YYYY-MM.csv  and can be fetched by n8n through the portal's
// /api/export/ledger/... endpoints, or pushed to an n8n webhook (N8N_WEBHOOK_URL).
//
// Manual runs:
//   docker compose exec backup node scripts/ledger-monthly-export.js            # last month
//   docker compose exec backup node scripts/ledger-monthly-export.js 2026-08    # a specific month
//   docker compose exec backup node scripts/ledger-monthly-export.js all        # entire ledger
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const EXPORT_DIR = process.env.LEDGER_EXPORT_DIR || '/exports';
const TIME_ZONE = process.env.LEDGER_EXPORT_TZ || 'Africa/Lagos';

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      max: 2
    });
  }
  return pool;
}

const COLUMNS = ['entry_id', 'txn_date', 'entry_type', 'source_type', 'source_id', 'member_id',
  'member_name', 'amount', 'description', 'status', 'created_at'];

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// "YYYY-MM" of the month before "now", judged in the configured time zone
function previousMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit' })
    .formatToParts(now);
  let year = Number(parts.find((p) => p.type === 'year').value);
  let month = Number(parts.find((p) => p.type === 'month').value) - 1;
  if (month === 0) { month = 12; year -= 1; }
  return `${year}-${String(month).padStart(2, '0')}`;
}

function fileFor(month) {
  return path.join(EXPORT_DIR, `penoks-ledger-${month}.csv`);
}

async function fetchRows(month) {
  const base = `
    SELECT a.entry_id, to_char(a.txn_date,'YYYY-MM-DD') AS txn_date, a.entry_type, a.source_type,
           a.source_id, a.member_id, m.full_name AS member_name, a.amount, a.description, a.status,
           to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
    FROM accounts a
    LEFT JOIN members m ON m.member_id = a.member_id`;
  if (month === 'all') {
    return (await getPool().query(`${base} ORDER BY a.txn_date ASC, a.entry_id ASC`)).rows;
  }
  return (await getPool().query(
    `${base}
     WHERE a.txn_date >= ($1 || '-01')::date
       AND a.txn_date <  (($1 || '-01')::date + interval '1 month')
     ORDER BY a.txn_date ASC, a.entry_id ASC`,
    [month]
  )).rows;
}

async function pushToWebhook(file, month, rowCount) {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return;
  const delays = [0, 30000, 120000]; // 3 attempts
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
    try {
      const form = new FormData();
      form.append('month', month);
      form.append('rows', String(rowCount));
      form.append('filename', path.basename(file));
      form.append('file', new Blob([fs.readFileSync(file)], { type: 'text/csv' }), path.basename(file));
      const headers = {};
      if (process.env.N8N_WEBHOOK_SECRET) headers['X-Webhook-Secret'] = process.env.N8N_WEBHOOK_SECRET;
      const res = await fetch(url, { method: 'POST', body: form, headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      console.log(`[ledger-export] Pushed ${path.basename(file)} to the n8n webhook.`);
      return;
    } catch (err) {
      console.error(`[ledger-export] Webhook attempt ${i + 1}/${delays.length} failed: ${err.message}`);
    }
  }
  console.error('[ledger-export] Webhook push gave up. The CSV is still saved and can be pulled from the portal API.');
}

async function runLedgerExport(month, { push = true } = {}) {
  month = month || previousMonth();
  if (month !== 'all' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error(`Invalid month "${month}" (use YYYY-MM or "all")`);
  }
  fs.mkdirSync(EXPORT_DIR, { recursive: true });

  const rows = await fetchRows(month);
  const lines = [COLUMNS.join(',')];
  rows.forEach((r) => lines.push(COLUMNS.map((c) => csvCell(r[c])).join(',')));

  const outFile = fileFor(month);
  const tmp = `${outFile}.tmp`;
  fs.writeFileSync(tmp, lines.join('\r\n') + '\r\n', 'utf8');
  fs.renameSync(tmp, outFile); // atomic: readers never see a half-written file
  console.log(`[ledger-export] ${path.basename(outFile)}: ${rows.length} row(s) written.`);

  if (push) await pushToWebhook(outFile, month, rows.length);
  return { file: outFile, month, rows: rows.length };
}

// If the container was down at 00:00 on the 1st, create last month's file on startup.
async function catchUpLastMonth() {
  const month = previousMonth();
  if (fs.existsSync(fileFor(month))) return;
  console.log(`[ledger-export] ${month} has not been exported yet - creating it now.`);
  await runLedgerExport(month);
}

module.exports = { runLedgerExport, catchUpLastMonth, previousMonth };

if (require.main === module) {
  runLedgerExport(process.argv[2], { push: process.env.NO_PUSH !== 'true' })
    .then(() => getPool().end())
    .catch((err) => { console.error('[ledger-export] FAILED:', err.message); if (pool) pool.end(); process.exit(1); });
}
