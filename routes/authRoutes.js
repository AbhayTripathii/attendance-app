// ============================================================
//  routes/authRoutes.js — Authentication Routes
// ============================================================

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/database');

// ─── POST /api/auth/login ─────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({ error: 'Email, password and role are required.' });
    }

    // Sanitize inputs
    const safeEmail = email.trim().toLowerCase();
    const safeRole  = ['admin', 'employee'].includes(role) ? role : null;
    if (!safeRole) return res.status(400).json({ error: 'Invalid role.' });

    // Query user from users table
    const [rows] = await db.execute(
      `SELECT id, name, email, password, role, department_id FROM users WHERE email = ? AND role = ? LIMIT 1`,
      [safeEmail, safeRole]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const user = rows[0];

    // Verify password (bcrypt)
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials.' });

    // Issue JWT
    const payload = { id: user.id, role: safeRole, email: user.email, name: user.name };
    const token = jwt.sign(payload, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '8h' });

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: safeRole, department_id: user.department_id }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────
router.post('/logout', async (req, res) => {
  // In a production app, blacklist the token using Redis
  res.json({ message: 'Logged out successfully.' });
});

// ─── POST /api/auth/register ──────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role, department_id } = req.body;

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    // BUG FIX: Added email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    // Check if email already exists
    const [existing] = await db.execute(
      'SELECT id FROM users WHERE email = ?',
      [email.trim().toLowerCase()]
    );

    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email already registered.' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const [result] = await db.execute(
      'INSERT INTO users (name, email, password, role, department_id) VALUES (?, ?, ?, ?, ?)',
      [name, email.trim().toLowerCase(), hashedPassword, role || 'employee', department_id || null]
    );

    res.status(201).json({
      message: 'Registration successful!',
      user: {
        id: result.insertId,
        name,
        email: email.trim().toLowerCase(),
        role: role || 'employee'
      }
    });

  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});


// ─── POST /api/auth/change-password ──────────────────────────
router.post('/change-password', async (req, res) => {
  try {
    const { userId, oldPassword, newPassword } = req.body;

    // BUG FIX: role param removed — always query the unified users table
    if (!userId || !oldPassword || !newPassword)
      return res.status(400).json({ error: 'All fields are required.' });
    if (newPassword.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    // BUG FIX: was querying non-existent 'admins'/'employees' tables with
    // non-existent 'password_hash' column. Users table uses 'password'.
    const [rows] = await db.execute(
      `SELECT password FROM users WHERE id = ?`,
      [userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' });

    const valid = await bcrypt.compare(oldPassword, rows[0].password);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

    const newHash = await bcrypt.hash(newPassword, 12);

    // BUG FIX: updated_at is handled automatically by the schema ON UPDATE trigger
    await db.execute(
      `UPDATE users SET password = ? WHERE id = ?`,
      [newHash, userId]
    );

    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;


// ============================================================
//  middleware/authMiddleware.js — JWT Verification
//  BUG FIX: This code was placed AFTER module.exports = router
//  meaning it was dead code and never exported. It belongs in
//  its own file: middleware/authMiddleware.js
//  Kept here as reference — copy to that file and import where needed.
// ============================================================

const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required.' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ error: 'Admin access required.' });
  next();
};

const requireEmployee = (req, res, next) => {
  if (!['admin', 'employee'].includes(req.user?.role))
    return res.status(403).json({ error: 'Authentication required.' });
  next();
};

// Export middleware separately for use in other route files
module.exports.verifyToken   = verifyToken;
module.exports.requireAdmin  = requireAdmin;
module.exports.requireEmployee = requireEmployee;
