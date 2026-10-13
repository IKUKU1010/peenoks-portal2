const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
const EXPORT_DIR = process.env.LEDGER_EXPORT_DIR || '/app/exports';
const FILE_RE = /^penoks-ledger-(\d{4}-(?:0[1-9]|1[0-2])|all)\.csv$/;

function listExports() {
  let names = [];
  try { names = fs.readdirSync(EXPORT_DIR); } catch (e) { return []; }
  return names
    .map((name) => ({ name, m: FILE_RE.exec(name) }))
    .filter((x) => x.m)
    .map((x) => {
      const st = fs.statSync(path.join(EXPORT_DIR, x.name));
      return { file: x.name, month: x.m[1], size: st.size, modified: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.month < b.month ? 1 : -1)); // newest first ("all" sorts after digits, handled below)
}
const monthlyOnly = (list) => list.filter((f) => f.month !== 'all');

function sendCsv(res, name) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(EXPORT_DIR, name), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'File not found' });
  });
}

// ---------- n8n / automation access (API key, no login) ----------
// Send the key as  X-API-Key: <EXPORT_API_KEY>  or  Authorization: Bearer <EXPORT_API_KEY>.
// With no EXPORT_API_KEY set in .env these endpoints are switched off.
function requireApiKey(req, res, next) {
  const expected = process.env.EXPORT_API_KEY;
  if (!expected) return res.status(503).json({ error: 'Export API is disabled. Set EXPORT_API_KEY in .env to enable it.' });
  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const given = req.get('x-api-key') || bearer;
  const h = (v) => crypto.createHash('sha256').update(String(v)).digest();
  if (!given || !crypto.timingSafeEqual(h(given), h(expected))) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
}

router.get('/api/export/ledger/files', requireApiKey, (req, res) => res.json(listExports()));

router.get('/api/export/ledger/latest', requireApiKey, (req, res) => {
  const latest = monthlyOnly(listExports())[0];
  if (!latest) return res.status(404).json({ error: 'No monthly ledger export exists yet.' });
  sendCsv(res, latest.file);
});

router.get('/api/export/ledger/:month', requireApiKey, (req, res) => {
  const name = `penoks-ledger-${req.params.month}.csv`;
  if (!FILE_RE.test(name) || !fs.existsSync(path.join(EXPORT_DIR, name))) {
    return res.status(404).json({ error: `No export found for "${req.params.month}" (use YYYY-MM or "all").` });
  }
  sendCsv(res, name);
});

// ---------- Admin page: see and download the exports ----------
router.get('/admin/ledger-exports', requireAdmin, (req, res) => res.render('admin/ledger-exports', { admin: req.admin }));
router.get('/api/admin/ledger-exports', requireAdmin, (req, res) => res.json(listExports()));
router.get('/api/admin/ledger-exports/:file', requireAdmin, (req, res) => {
  if (!FILE_RE.test(req.params.file)) return res.status(404).end();
  sendCsv(res, req.params.file);
});

module.exports = router;
