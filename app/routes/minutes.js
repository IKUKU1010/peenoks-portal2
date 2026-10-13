const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { requireMember, requireAdmin } = require('../middleware/auth');
const { uploadMinutes } = require('../middleware/upload');

const router = express.Router();
const UPLOAD_ROOT = '/app/uploads';

// Creates the table on existing databases (init.sql only runs on a brand-new
// volume). Safe to run on every start. Called from server.js after the DB is up.
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meeting_minutes (
      minutes_id     SERIAL PRIMARY KEY,
      title          VARCHAR(200) NOT NULL,
      meeting_date   DATE NOT NULL,
      file_path      TEXT NOT NULL,
      original_name  VARCHAR(255),
      uploaded_by    INTEGER REFERENCES admins(admin_id),
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_meeting_minutes_date ON meeting_minutes(meeting_date)');
}

function noStorePdf(res) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
}

// ---------- Member pages (only reachable when logged in) ----------
router.get('/meeting-minutes', requireMember, (req, res) => res.render('member/minutes'));
router.get('/meeting-minutes/:id', requireMember, (req, res) => {
  res.render('member/minutes-view', { minutesId: Number(req.params.id) || 0 });
});

router.get('/api/member/minutes', requireMember, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT minutes_id, title, to_char(meeting_date,'YYYY-MM-DD') AS meeting_date
       FROM meeting_minutes ORDER BY meeting_date DESC, created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load meeting minutes' });
  }
});

router.get('/api/member/minutes/:id', requireMember, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT minutes_id, title, to_char(meeting_date,'YYYY-MM-DD') AS meeting_date
       FROM meeting_minutes WHERE minutes_id = $1`, [Number(req.params.id) || 0]
    );
    if (!rows.length) return res.status(404).json({ error: 'Minutes not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load meeting minutes' });
  }
});

// Streams the PDF inline (the viewer page renders it with PDF.js, no download button)
router.get('/api/member/minutes/:id/file', requireMember, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT file_path FROM meeting_minutes WHERE minutes_id = $1', [Number(req.params.id) || 0]);
    if (!rows.length) return res.status(404).json({ error: 'Minutes not found' });
    noStorePdf(res);
    res.sendFile(path.join(UPLOAD_ROOT, rows[0].file_path), (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'The file is missing on the server.' });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load the document' });
  }
});

// ---------- Admin ----------
router.get('/admin/minutes', requireAdmin, (req, res) => res.render('admin/minutes', { admin: req.admin }));

router.get('/api/admin/minutes', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT minutes_id, title, original_name, to_char(meeting_date,'YYYY-MM-DD') AS meeting_date, created_at
       FROM meeting_minutes ORDER BY meeting_date DESC, created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load meeting minutes' });
  }
});

router.post('/api/admin/minutes', requireAdmin, (req, res) => {
  uploadMinutes.single('minutes_pdf')(req, res, async (uploadErr) => {
    if (uploadErr) {
      const msg = uploadErr.code === 'LIMIT_FILE_SIZE' ? 'That PDF is larger than 20MB.' : uploadErr.message;
      return res.status(400).json({ error: msg });
    }
    const removeUpload = () => { if (req.file) fs.unlink(req.file.path, () => {}); };

    const title = (req.body.title || '').trim();
    const meetingDate = (req.body.meeting_date || '').trim();
    if (!req.file) return res.status(400).json({ error: 'Please choose a PDF file.' });
    if (!title || title.length > 200) { removeUpload(); return res.status(400).json({ error: 'Please enter a title (up to 200 characters).' }); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate) || Number.isNaN(Date.parse(meetingDate))) {
      removeUpload(); return res.status(400).json({ error: 'Please choose the meeting date.' });
    }

    // The mime type comes from the browser, so confirm the file really is a PDF
    try {
      const fd = fs.openSync(req.file.path, 'r');
      const buf = Buffer.alloc(5);
      fs.readSync(fd, buf, 0, 5, 0);
      fs.closeSync(fd);
      if (buf.toString() !== '%PDF-') { removeUpload(); return res.status(400).json({ error: 'That file is not a valid PDF.' }); }
    } catch (e) {
      removeUpload();
      return res.status(500).json({ error: 'Could not read the uploaded file.' });
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO meeting_minutes (title, meeting_date, file_path, original_name, uploaded_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING minutes_id`,
        [title, meetingDate, path.posix.join('minutes', req.file.filename), req.file.originalname.slice(0, 255), req.admin.adminId]
      );
      res.json({ ok: true, minutesId: rows[0].minutes_id });
    } catch (err) {
      removeUpload();
      console.error(err);
      res.status(500).json({ error: 'Could not save the meeting minutes' });
    }
  });
});

router.delete('/api/admin/minutes/:id', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM meeting_minutes WHERE minutes_id = $1 RETURNING file_path', [Number(req.params.id) || 0]);
    if (!rows.length) return res.status(404).json({ error: 'Minutes not found' });
    fs.unlink(path.join(UPLOAD_ROOT, rows[0].file_path), () => {});
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete the minutes' });
  }
});

// Admin preview of the original file (so the admin can check what members will see)
router.get('/api/admin/minutes/:id/file', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT file_path FROM meeting_minutes WHERE minutes_id = $1', [Number(req.params.id) || 0]);
    if (!rows.length) return res.status(404).end();
    noStorePdf(res);
    res.sendFile(path.join(UPLOAD_ROOT, rows[0].file_path), (err) => { if (err && !res.headersSent) res.status(404).end(); });
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

module.exports = router;
module.exports.ensureSchema = ensureSchema;
