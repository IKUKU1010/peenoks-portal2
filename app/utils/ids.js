const pool = require('../config/db');

async function nextMemberId() {
  const { rows } = await pool.query("SELECT nextval('member_id_seq') AS n");
  return `PNK-${String(rows[0].n).padStart(4, '0')}`;
}

async function nextPaymentId() {
  const { rows } = await pool.query("SELECT nextval('payment_id_seq') AS n");
  return `PMT-${String(rows[0].n).padStart(6, '0')}`;
}

async function nextExpenseId() {
  const { rows } = await pool.query("SELECT nextval('expense_id_seq') AS n");
  return `EXP-${String(rows[0].n).padStart(6, '0')}`;
}

function randomPassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

module.exports = { nextMemberId, nextPaymentId, nextExpenseId, randomPassword };

// Validates a YYYY-MM-DD string from a date input. Returns the string if it is a
// real calendar date that is not in the future (1 day of slack for time zones),
// null if empty, and throws on anything malformed.
function parseDateInput(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const str = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) throw new Error('Please enter a valid date.');
  const d = new Date(str + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== str) throw new Error('Please enter a valid date.');
  const limit = Date.now() + 36 * 60 * 60 * 1000;
  if (d.getTime() > limit) throw new Error('The date cannot be in the future.');
  if (d.getFullYear() < 2000) throw new Error('Please enter a valid date.');
  return str;
}

module.exports.parseDateInput = parseDateInput;
