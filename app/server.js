require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');

const pool = require('./config/db');
const authRoutes = require('./routes/auth');
const publicRoutes = require('./routes/public');
const memberRoutes = require('./routes/member');
const adminRoutes = require('./routes/admin');
const contactRoutes = require('./routes/contact');
const constitutionRoutes = require('./routes/constitution');
const minutesRoutes = require('./routes/minutes');
const exportRoutes = require('./routes/exports');
const { requireMember, requireAdmin } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static public site (index.html, about.html, contact.html, apply/payment/expense forms, css/js/assets)
app.use(express.static(path.join(__dirname, 'public')));

// Route modules
app.use(authRoutes);
app.use(publicRoutes);
app.use(memberRoutes);
app.use(adminRoutes);
app.use(contactRoutes);
app.use(constitutionRoutes);
app.use(minutesRoutes);
app.use(exportRoutes);

// Lightweight guards for pages that need a valid session before rendering
// (the /dashboard and /admin/* view routes already call requireMember /
// requireAdmin inside their own router files)

app.get('/health', (req, res) => res.json({ ok: true }));

app.use((req, res) => res.status(404).send('Not found'));

app.use((err, req, res, next) => {
  console.error(err);
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
  res.status(500).send('Server error');
});

async function ensureSeedAdmin() {
  const username = process.env.SEED_ADMIN_USERNAME;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!username || !password) return;
  const { rows } = await pool.query('SELECT admin_id FROM admins WHERE username = $1', [username]);
  if (rows.length) return;
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    'INSERT INTO admins (username, password_hash, full_name, role) VALUES ($1,$2,$3,$4)',
    [username, hash, 'Super Admin', 'superadmin']
  );
  console.log(`Seed admin account created: ${username}`);
}

async function start() {
  // Retry DB connection briefly in case Postgres is still starting up
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (err) {
      console.log(`Waiting for database... (${attempt}/10)`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  await ensureSeedAdmin();
  try { await minutesRoutes.ensureSchema(); } catch (err) { console.error('Could not ensure meeting_minutes table:', err.message); }
  app.listen(PORT, () => console.log(`PENOKS Club Portal listening on port ${PORT}`));
}

start();
