const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const pool = require('../config/db');

const router = express.Router();

const PDF_PATH = path.join(__dirname, '..', 'private', 'club-constitution.pdf');
const TOKEN_TTL = '20m';
const COOKIE_NAME = 'constitution_token';

// ---------- Minimal in-memory brute-force throttle ----------
// Not a substitute for a real rate limiter under heavy load, but enough to
// slow down naive password-guessing against this single-file endpoint.
const attempts = new Map(); // ip -> { count, windowStart }
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function isRateLimited(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.windowStart > WINDOW_MS) {
    attempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_ATTEMPTS;
}

function resetAttempts(ip) {
  attempts.delete(ip);
}

// ---------- Unlock: accepts a Member ID OR a member's account password ----------
router.post('/api/constitution/unlock', async (req, res) => {
  const ip = req.ip;
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
  }

  const { secret } = req.body;
  if (!secret || typeof secret !== 'string') {
    return res.status(400).json({ error: 'Please enter your Member ID or password.' });
  }

  try {
    // Path 1: exact Member ID match (case-insensitive), active members only
    const idMatch = await pool.query(
      `SELECT member_id FROM members WHERE lower(member_id) = lower($1) AND status = 'active'`,
      [secret.trim()]
    );
    let authorized = idMatch.rows.length > 0;

    // Path 2: matches any active member's account password
    if (!authorized) {
      const allActive = await pool.query(`SELECT password_hash FROM members WHERE status = 'active'`);
      for (const row of allActive.rows) {
        if (await bcrypt.compare(secret, row.password_hash)) {
          authorized = true;
          break;
        }
      }
    }

    if (!authorized) {
      return res.status(401).json({ error: 'That Member ID or password was not recognized.' });
    }

    resetAttempts(ip);
    const token = jwt.sign({ role: 'constitution-viewer' }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: 20 * 60 * 1000
    });
    res.json({ ok: true, expiresInMinutes: 20 });
  } catch (err) {
    console.error('[constitution] unlock error:', err);
    res.status(500).json({ error: 'Could not verify your credentials right now. Please try again.' });
  }
});

// ---------- View: streams the PDF only with a valid short-lived token ----------
router.get('/api/constitution/view', (req, res) => {
  const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
  if (!token) return res.status(401).json({ error: 'Your viewing session has expired. Please enter your credentials again.' });

  try {
    jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Your viewing session has expired. Please enter your credentials again.' });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline'); // no filename hint, discourages "save as" naming
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.sendFile(PDF_PATH, (err) => {
    if (err) {
      console.error('[constitution] could not send file:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Could not load the document.' });
    }
  });
});

module.exports = router;
