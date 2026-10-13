const express = require('express');
const pool = require('../config/db');
const { uploadPhoto, uploadReceipt, uploadBudget } = require('../middleware/upload');
const { nextPaymentId, nextExpenseId, parseDateInput } = require('../utils/ids');

const router = express.Router();

// ---------- New member application (member-apply.html) ----------
router.post('/api/applicants', uploadPhoto.single('passportPhoto'), async (req, res) => {
  const {
    fullName, birthMonth, birthDay, nationality, occupation,
    phone, email, address,
    interests, reasonForJoining,
    referee1Name, referee1Contact, referee2Name, referee2Contact,
    termsAccepted, consentGiven, signatureText
  } = req.body;

  const month = Number(birthMonth);
  const day = Number(birthDay);

  if (!fullName || !birthMonth || !birthDay || !nationality || !phone || !email || !address) {
    return res.status(400).json({ error: 'Please complete all required fields.' });
  }
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 31) {
    return res.status(400).json({ error: 'Please enter a valid birthday (month and day).' });
  }
  if (termsAccepted !== 'true' && termsAccepted !== true) {
    return res.status(400).json({ error: 'You must accept the terms to apply.' });
  }

  try {
    const photoPath = req.file ? `photos/${req.file.filename}` : null;
    const { rows } = await pool.query(
      `INSERT INTO applicants
        (full_name, birth_month, birth_day, nationality, occupation, phone, email, address,
         interests, reason_for_joining, referee1_name, referee1_contact,
         referee2_name, referee2_contact, terms_accepted, consent_given,
         signature_text, photo_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING applicant_id`,
      [fullName, month, day, nationality, occupation || null, phone, email, address,
       interests || null, reasonForJoining || null, referee1Name || null, referee1Contact || null,
       referee2Name || null, referee2Contact || null, true, !!consentGiven,
       signatureText || null, photoPath]
    );
    res.json({ ok: true, applicantId: rows[0].applicant_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not submit application. Please try again.' });
  }
});

// ---------- Submit payment (submit-payment.html) ----------
router.post('/api/payments', uploadReceipt.single('receipt'), async (req, res) => {
  const { names, memberNumber, purpose, amount, paymentDate } = req.body;
  if (!names || !memberNumber || !purpose || !amount) {
    return res.status(400).json({ error: 'Please complete all fields.' });
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Enter a valid amount.' });
  }
  let payDate;
  try { payDate = parseDateInput(paymentDate); } catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const memberRes = await pool.query('SELECT member_id FROM members WHERE member_id = $1 AND status = $2', [memberNumber.trim(), 'active']);
    if (!memberRes.rows.length) {
      return res.status(404).json({ error: 'Member number not found or membership inactive.' });
    }
    const receiptPath = req.file ? `receipts/${req.file.filename}` : null;
    const paymentId = await nextPaymentId();
    await pool.query(
      `INSERT INTO payments (payment_id, member_id, names, purpose, amount, receipt_path, payment_date)
       VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7::date, CURRENT_DATE))`,
      [paymentId, memberNumber.trim(), names, purpose, amt, receiptPath, payDate]
    );
    res.json({ ok: true, paymentId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not submit payment. Please try again.' });
  }
});

// ---------- Submit expense request (submit-expenses.html) ----------
router.post('/api/expenses', uploadBudget.single('budgetSheet'), async (req, res) => {
  const { names, memberNumber, purpose, amount, expenseDate } = req.body;
  if (!names || !memberNumber || !purpose || !amount) {
    return res.status(400).json({ error: 'Please complete all fields.' });
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Enter a valid amount.' });
  }
  let expDate;
  try { expDate = parseDateInput(expenseDate); } catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const memberRes = await pool.query('SELECT member_id FROM members WHERE member_id = $1 AND status = $2', [memberNumber.trim(), 'active']);
    if (!memberRes.rows.length) {
      return res.status(404).json({ error: 'Member number not found or membership inactive.' });
    }
    const budgetPath = req.file ? `budgets/${req.file.filename}` : null;
    const expenseId = await nextExpenseId();
    await pool.query(
      `INSERT INTO expenses (expense_id, member_id, names, purpose, amount, budget_sheet_path, expense_date)
       VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7::date, CURRENT_DATE))`,
      [expenseId, memberNumber.trim(), names, purpose, amt, budgetPath, expDate]
    );
    res.json({ ok: true, expenseId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not submit expense request. Please try again.' });
  }
});

module.exports = router;
