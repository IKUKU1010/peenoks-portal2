const jwt = require('jsonwebtoken');

function verifyToken(cookieName, req) {
  const token = req.cookies ? req.cookies[cookieName] : null;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// Requires a logged-in member. Populates req.member = { memberId }
function requireMember(req, res, next) {
  const payload = verifyToken('member_token', req);
  if (!payload || payload.role !== 'member') {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.redirect('/login.html');
  }
  req.member = payload;
  next();
}

// Requires a logged-in admin. Populates req.admin = { adminId, username, role }
function requireAdmin(req, res, next) {
  const payload = verifyToken('admin_token', req);
  if (!payload || payload.role !== 'admin' && payload.role !== 'superadmin') {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.redirect('/admin/login.html');
  }
  req.admin = payload;
  next();
}

module.exports = { requireMember, requireAdmin, verifyToken };
