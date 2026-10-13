const express = require('express');
const path = require('path');
const pool = require('../config/db');
const { requireMember } = require('../middleware/auth');

const router = express.Router();

router.get('/dashboard', requireMember, (req, res) => {
  res.render('dashboard', { fullName: req.member.fullName, memberId: req.member.memberId });
});

// View-only member directory and club accounts ledger (available to any
// logged-in member; no edit capability is exposed anywhere on these pages)
router.get('/members', requireMember, (req, res) => res.render('member/directory'));
router.get('/club-accounts', requireMember, (req, res) => res.render('member/accounts'));

router.get('/api/member/directory', requireMember, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT member_id, full_name, status, joined_at FROM members ORDER BY full_name ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load member directory' });
  }
});

router.get('/api/member/ledger', requireMember, async (req, res) => {
  const { from, to } = req.query;
  const dateConditions = [];
  const params = [];
  if (from) {
    params.push(from);
    dateConditions.push(`a.txn_date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    dateConditions.push(`a.txn_date <= $${params.length}::date`);
  }
  const dateWhere = dateConditions.length ? `AND ${dateConditions.join(' AND ')}` : '';

  try {
    const entriesQ = await pool.query(
      `SELECT a.entry_id, a.entry_type, a.amount, a.description, a.created_at,
              to_char(a.txn_date,'YYYY-MM-DD') AS txn_date, m.full_name AS member_name
       FROM accounts a
       LEFT JOIN members m ON m.member_id = a.member_id
       WHERE a.status = 'posted' ${dateWhere}
       ORDER BY a.txn_date DESC, a.created_at DESC LIMIT 2000`,
      params
    );
    const totalsQ = await pool.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE entry_type='credit'),0) AS total_credit,
              COALESCE(SUM(amount) FILTER (WHERE entry_type='debit'),0) AS total_debit
       FROM accounts a WHERE a.status = 'posted' ${dateWhere}`,
      params
    );
    res.json({ entries: entriesQ.rows, ...totalsQ.rows[0], from: from || null, to: to || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load club accounts' });
  }
});

// Profile + financial summary as JSON, consumed by dashboard.ejs
router.get('/api/member/me', requireMember, async (req, res) => {
  try {
    const memberQ = await pool.query(
      `SELECT member_id, full_name, birth_month, birth_day, nationality, occupation, phone, email,
              address, interests, reason_for_joining, photo_path, status, joined_at,
              must_change_password
       FROM members WHERE member_id = $1`,
      [req.member.memberId]
    );
    if (!memberQ.rows.length) return res.status(404).json({ error: 'Member not found' });

    const paymentsQ = await pool.query(
      `SELECT payment_id, purpose, amount, status, admin_note, created_at,
              to_char(payment_date,'YYYY-MM-DD') AS payment_date
       FROM payments WHERE member_id = $1 ORDER BY payment_date DESC, created_at DESC`,
      [req.member.memberId]
    );

    const expensesQ = await pool.query(
      `SELECT expense_id, purpose, amount, status, admin_note, created_at,
              to_char(expense_date,'YYYY-MM-DD') AS expense_date
       FROM expenses WHERE member_id = $1 ORDER BY expense_date DESC, created_at DESC`,
      [req.member.memberId]
    );

    const totalsQ = await pool.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE entry_type = 'credit'), 0) AS total_paid,
         COALESCE(SUM(amount) FILTER (WHERE entry_type = 'debit'), 0) AS total_expensed
       FROM accounts WHERE member_id = $1 AND status = 'posted'`,
      [req.member.memberId]
    );

    res.json({
      profile: memberQ.rows[0],
      payments: paymentsQ.rows,
      expenses: expensesQ.rows,
      totals: totalsQ.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load dashboard data' });
  }
});

// Member can view (download) only their own uploaded files
router.get('/api/member/file/:type/:filename', requireMember, async (req, res) => {
  const { type, filename } = req.params;
  const allowed = { photo: 'photo_path' };
  try {
    if (type === 'photo') {
      const { rows } = await pool.query('SELECT photo_path FROM members WHERE member_id = $1', [req.member.memberId]);
      if (!rows.length || !rows[0].photo_path || !rows[0].photo_path.endsWith(filename)) {
        return res.status(404).end();
      }
      return res.sendFile(path.join('/app/uploads', rows[0].photo_path));
    }
    if (type === 'receipt') {
      const { rows } = await pool.query(
        'SELECT receipt_path FROM payments WHERE member_id = $1 AND receipt_path LIKE $2',
        [req.member.memberId, `%${filename}`]
      );
      if (!rows.length || !rows[0].receipt_path) return res.status(404).end();
      return res.sendFile(path.join('/app/uploads', rows[0].receipt_path));
    }
    res.status(404).end();
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

module.exports = router;
