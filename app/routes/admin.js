const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { sendPasswordResetEmail } = require('../utils/mailer');
const pool = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const { nextMemberId, randomPassword } = require('../utils/ids');

const router = express.Router();

// ---------- Page views ----------
router.get('/admin/dashboard', requireAdmin, (req, res) => res.render('admin/dashboard', { admin: req.admin }));
router.get('/admin/applicants', requireAdmin, (req, res) => res.render('admin/applicants', { admin: req.admin }));
router.get('/admin/members', requireAdmin, (req, res) => res.render('admin/members', { admin: req.admin }));
router.get('/admin/members/:id', requireAdmin, (req, res) => res.render('admin/member-detail', { admin: req.admin, memberId: req.params.id }));
router.get('/admin/payments', requireAdmin, (req, res) => res.render('admin/payments', { admin: req.admin }));
router.get('/admin/expenses', requireAdmin, (req, res) => res.render('admin/expenses', { admin: req.admin }));
router.get('/admin/accounts', requireAdmin, (req, res) => res.render('admin/accounts', { admin: req.admin }));

// ---------- Dashboard summary ----------
router.get('/api/admin/summary', requireAdmin, async (req, res) => {
  try {
    const [applicants, members, payments, expenses, balance] = await Promise.all([
      pool.query("SELECT count(*) FROM applicants WHERE status = 'pending'"),
      pool.query("SELECT count(*) FROM members WHERE status = 'active'"),
      pool.query("SELECT count(*) FROM payments WHERE status = 'pending'"),
      pool.query("SELECT count(*) FROM expenses WHERE status = 'pending'"),
      pool.query(`SELECT COALESCE(SUM(amount) FILTER (WHERE entry_type='credit'),0) -
                         COALESCE(SUM(amount) FILTER (WHERE entry_type='debit'),0) AS balance
                  FROM accounts WHERE status = 'posted'`)
    ]);
    res.json({
      pendingApplicants: Number(applicants.rows[0].count),
      activeMembers: Number(members.rows[0].count),
      pendingPayments: Number(payments.rows[0].count),
      pendingExpenses: Number(expenses.rows[0].count),
      clubBalance: Number(balance.rows[0].balance)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load summary' });
  }
});

// ---------- Applicants ----------
router.get('/api/admin/applicants', requireAdmin, async (req, res) => {
  const status = req.query.status || 'pending';
  try {
    const { rows } = await pool.query(
      'SELECT * FROM applicants WHERE status = $1 ORDER BY created_at ASC',
      [status]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load applicants' });
  }
});

router.post('/api/admin/applicants/:id/approve', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const appQ = await client.query('SELECT * FROM applicants WHERE applicant_id = $1 FOR UPDATE', [req.params.id]);
    if (!appQ.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Applicant not found' }); }
    const applicant = appQ.rows[0];
    if (applicant.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Applicant has already been reviewed' });
    }

    const memberId = await nextMemberId();
    const tempPassword = randomPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    await client.query(
      `INSERT INTO members
        (member_id, applicant_id, full_name, birth_month, birth_day, nationality, occupation, phone, email,
         address, interests, reason_for_joining, photo_path, password_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [memberId, applicant.applicant_id, applicant.full_name, applicant.birth_month, applicant.birth_day,
       applicant.nationality, applicant.occupation, applicant.phone, applicant.email, applicant.address,
       applicant.interests, applicant.reason_for_joining, applicant.photo_path, passwordHash]
    );

    await client.query(
      `UPDATE applicants SET status = 'approved', reviewed_by = $1, reviewed_at = now(), approved_member_id = $2
       WHERE applicant_id = $3`,
      [req.admin.adminId, memberId, applicant.applicant_id]
    );

    await client.query('COMMIT');
    // Temp password is returned once, here, for the admin to relay to the applicant.
    res.json({ ok: true, memberId, tempPassword });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not approve applicant' });
  } finally {
    client.release();
  }
});

router.post('/api/admin/applicants/:id/reject', requireAdmin, async (req, res) => {
  const { reason } = req.body;
  try {
    const result = await pool.query(
      `UPDATE applicants SET status = 'rejected', rejection_reason = $1,
        reviewed_by = $2, reviewed_at = now()
       WHERE applicant_id = $3 AND status = 'pending' RETURNING applicant_id`,
      [reason || null, req.admin.adminId, req.params.id]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'Applicant not found or already reviewed' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not reject applicant' });
  }
});

router.get('/api/admin/applicants/:id/photo', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT photo_path FROM applicants WHERE applicant_id = $1', [req.params.id]);
    if (!rows.length || !rows[0].photo_path) return res.status(404).end();
    res.sendFile(path.join('/app/uploads', rows[0].photo_path));
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

// ---------- Members ----------
router.get('/api/admin/members', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT member_id, full_name, email, phone, status, joined_at FROM members ORDER BY joined_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load members' });
  }
});

router.get('/api/admin/members/:id', requireAdmin, async (req, res) => {
  try {
    const memberQ = await pool.query(
      `SELECT member_id, applicant_id, full_name, birth_month, birth_day, nationality, occupation, phone, email,
              address, interests, reason_for_joining, photo_path, must_change_password,
              status, joined_at, created_at, updated_at
       FROM members WHERE member_id = $1`,
      [req.params.id]
    );
    if (!memberQ.rows.length) return res.status(404).json({ error: 'Member not found' });

    const paymentsQ = await pool.query(
      `SELECT payment_id, purpose, amount, status, admin_note, created_at,
              to_char(payment_date,'YYYY-MM-DD') AS payment_date
       FROM payments WHERE member_id = $1 ORDER BY payment_date DESC, created_at DESC`,
      [req.params.id]
    );
    const expensesQ = await pool.query(
      `SELECT expense_id, purpose, amount, status, admin_note, created_at,
              to_char(expense_date,'YYYY-MM-DD') AS expense_date
       FROM expenses WHERE member_id = $1 ORDER BY expense_date DESC, created_at DESC`,
      [req.params.id]
    );
    const ledgerQ = await pool.query(
      `SELECT entry_id, entry_type, source_type, source_id, amount, description, status, created_at,
              to_char(txn_date,'YYYY-MM-DD') AS txn_date
       FROM accounts WHERE member_id = $1 ORDER BY txn_date DESC, created_at DESC`,
      [req.params.id]
    );
    const totalsQ = await pool.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE entry_type = 'credit'), 0) AS total_paid,
              COALESCE(SUM(amount) FILTER (WHERE entry_type = 'debit'), 0) AS total_expensed
       FROM accounts WHERE member_id = $1 AND status = 'posted'`,
      [req.params.id]
    );

    res.json({
      profile: memberQ.rows[0],
      payments: paymentsQ.rows,
      expenses: expensesQ.rows,
      ledger: ledgerQ.rows,
      totals: totalsQ.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load member' });
  }
});

// ---------- Password reset (admin-initiated) ----------
// Passwords are stored only as one-way bcrypt hashes, so an existing password can
// never be read back. Instead the admin can (a) issue a new temporary password,
// shown once, or (b) email the member a single-use reset link.
router.post('/api/admin/members/:id/reset-password', requireAdmin, async (req, res) => {
  try {
    const tempPassword = randomPassword();
    const hash = await bcrypt.hash(tempPassword, 10);
    const result = await pool.query(
      `UPDATE members SET password_hash = $1, must_change_password = true,
              reset_token_hash = NULL, reset_token_expires = NULL, updated_at = now()
       WHERE member_id = $2 RETURNING member_id`,
      [hash, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Member not found' });
    res.json({ ok: true, memberId: req.params.id, tempPassword });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not reset password' });
  }
});

router.post('/api/admin/members/:id/send-reset-link', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT member_id, full_name, email FROM members WHERE member_id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    const member = rows[0];
    if (!member.email) return res.status(400).json({ error: 'This member has no email address on file.' });

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await pool.query(
      `UPDATE members SET reset_token_hash = $1, reset_token_expires = now() + interval '1 hour'
       WHERE member_id = $2`,
      [tokenHash, member.member_id]
    );

    const baseUrl = (process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const resetLink = `${baseUrl}/reset-password.html?token=${token}`;
    try {
      await sendPasswordResetEmail({ to: member.email, fullName: member.full_name, memberId: member.member_id, resetLink });
    } catch (mailErr) {
      console.error('[reset] email failed:', mailErr.message);
      await pool.query('UPDATE members SET reset_token_hash = NULL, reset_token_expires = NULL WHERE member_id = $1', [member.member_id]);
      return res.status(502).json({ error: 'Could not send the email. Check the SMTP settings, or use "Generate Temporary Password" instead.' });
    }
    // The token is never returned to the admin, so the link can only be used by the mailbox owner.
    const [user, domain] = member.email.split('@');
    res.json({ ok: true, sentTo: `${user.slice(0, 2)}***@${domain}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not send reset link' });
  }
});

router.delete('/api/admin/members/:id', requireAdmin, async (req, res) => {
  const memberId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const memberQ = await client.query('SELECT * FROM members WHERE member_id = $1 FOR UPDATE', [memberId]);
    if (!memberQ.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Member not found' }); }
    const member = memberQ.rows[0];

    // Deleting a member permanently removes their financial trail too, so
    // the club balance/ledger totals will change. The confirmation warning
    // on the admin UI makes this explicit before this endpoint is ever hit.
    await client.query('DELETE FROM accounts WHERE member_id = $1', [memberId]);
    await client.query('DELETE FROM payments WHERE member_id = $1', [memberId]);
    await client.query('DELETE FROM expenses WHERE member_id = $1', [memberId]);
    await client.query('DELETE FROM members WHERE member_id = $1', [memberId]);
    await client.query('COMMIT');

    // Best-effort cleanup of the uploaded photo file; failures here don't
    // affect the already-committed database deletion.
    if (member.photo_path) {
      const filePath = path.join('/app/uploads', member.photo_path);
      fs.unlink(filePath, () => {});
    }

    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not delete member' });
  } finally {
    client.release();
  }
});

router.post('/api/admin/members/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body; // 'active' | 'suspended'
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    await pool.query('UPDATE members SET status = $1, updated_at = now() WHERE member_id = $2', [status, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update member status' });
  }
});

// ---------- Payments (verify -> posts a credit to accounts) ----------
router.get('/api/admin/payments', requireAdmin, async (req, res) => {
  const status = req.query.status || 'pending';
  try {
    const { rows } = await pool.query(
      `SELECT p.*, to_char(p.payment_date,'YYYY-MM-DD') AS payment_date, m.full_name AS member_name FROM payments p
       JOIN members m ON m.member_id = p.member_id
       WHERE p.status = $1 ORDER BY p.created_at ASC`,
      [status]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load payments' });
  }
});

router.post('/api/admin/payments/:id/verify', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pQ = await client.query('SELECT * FROM payments WHERE payment_id = $1 FOR UPDATE', [req.params.id]);
    if (!pQ.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Payment not found' }); }
    const payment = pQ.rows[0];
    if (payment.status !== 'pending') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Already reviewed' }); }

    await client.query(
      `UPDATE payments SET status = 'verified', reviewed_by = $1, reviewed_at = now() WHERE payment_id = $2`,
      [req.admin.adminId, payment.payment_id]
    );
    await client.query(
      `INSERT INTO accounts (entry_type, source_type, source_id, member_id, amount, description, txn_date)
       VALUES ('credit', 'payment', $1, $2, $3, $4, $5)`,
      [payment.payment_id, payment.member_id, payment.amount, payment.purpose, payment.payment_date]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not verify payment' });
  } finally {
    client.release();
  }
});

router.post('/api/admin/payments/:id/reject', requireAdmin, async (req, res) => {
  const { note } = req.body;
  try {
    const result = await pool.query(
      `UPDATE payments SET status = 'rejected', admin_note = $1, reviewed_by = $2, reviewed_at = now()
       WHERE payment_id = $3 AND status = 'pending' RETURNING payment_id`,
      [note || null, req.admin.adminId, req.params.id]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'Payment not found or already reviewed' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not reject payment' });
  }
});

// ---------- Expenses (approve -> posts a debit to accounts) ----------
router.get('/api/admin/expenses', requireAdmin, async (req, res) => {
  const status = req.query.status || 'pending';
  try {
    const { rows } = await pool.query(
      `SELECT e.*, to_char(e.expense_date,'YYYY-MM-DD') AS expense_date, m.full_name AS member_name FROM expenses e
       JOIN members m ON m.member_id = e.member_id
       WHERE e.status = $1 ORDER BY e.created_at ASC`,
      [status]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load expenses' });
  }
});

router.post('/api/admin/expenses/:id/approve', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const eQ = await client.query('SELECT * FROM expenses WHERE expense_id = $1 FOR UPDATE', [req.params.id]);
    if (!eQ.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Expense not found' }); }
    const expense = eQ.rows[0];
    if (expense.status !== 'pending') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Already reviewed' }); }

    await client.query(
      `UPDATE expenses SET status = 'approved', reviewed_by = $1, reviewed_at = now() WHERE expense_id = $2`,
      [req.admin.adminId, expense.expense_id]
    );
    await client.query(
      `INSERT INTO accounts (entry_type, source_type, source_id, member_id, amount, description, txn_date)
       VALUES ('debit', 'expense', $1, $2, $3, $4, $5)`,
      [expense.expense_id, expense.member_id, expense.amount, expense.purpose, expense.expense_date]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not approve expense' });
  } finally {
    client.release();
  }
});

router.post('/api/admin/expenses/:id/reject', requireAdmin, async (req, res) => {
  const { note } = req.body;
  try {
    const result = await pool.query(
      `UPDATE expenses SET status = 'rejected', admin_note = $1, reviewed_by = $2, reviewed_at = now()
       WHERE expense_id = $3 AND status = 'pending' RETURNING expense_id`,
      [note || null, req.admin.adminId, req.params.id]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'Expense not found or already reviewed' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not reject expense' });
  }
});

// ---------- Accounts ledger ----------
router.get('/api/admin/accounts', requireAdmin, async (req, res) => {
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
    const { rows } = await pool.query(
      `SELECT a.*, to_char(a.txn_date,'YYYY-MM-DD') AS txn_date, m.full_name AS member_name FROM accounts a
       LEFT JOIN members m ON m.member_id = a.member_id
       WHERE 1=1 ${dateWhere}
       ORDER BY a.txn_date DESC, a.created_at DESC LIMIT 2000`,
      params
    );
    const balanceQ = await pool.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE entry_type='credit'),0) AS total_credit,
              COALESCE(SUM(amount) FILTER (WHERE entry_type='debit'),0) AS total_debit
       FROM accounts a
       WHERE a.status = 'posted' ${dateWhere}`,
      params
    );
    res.json({ entries: rows, ...balanceQ.rows[0], from: from || null, to: to || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load accounts' });
  }
});

// Generic protected file access for admins (receipts / budget sheets / photos)
router.get('/api/admin/file/:type/:filename', requireAdmin, (req, res) => {
  const { type, filename } = req.params;
  const dirs = { photo: 'photos', receipt: 'receipts', budget: 'budgets' };
  const dir = dirs[type];
  if (!dir) return res.status(404).end();
  res.sendFile(path.join('/app/uploads', dir, filename), (err) => {
    if (err) res.status(404).end();
  });
});

module.exports = router;
