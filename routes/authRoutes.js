// ============================================================
//  routes/authRoutes.js — Authentication Routes
// ============================================================

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'attendance_secret_key_2024';

// ─── Run migrations on startup ────────────────────────────────
(async () => {
  try {
    await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name VARCHAR(200) DEFAULT NULL`);
    console.log('✅ DB migration: company_name column ready');
  } catch(e) { console.warn('Migration note:', e.message); }
})();

// ─── Middleware: verify JWT ───────────────────────────────────
const verifyToken = (req, res, next) => {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
};

// ─── GET /api/auth/departments — list depts (for register dropdown) ──
router.get('/departments', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT id, name, description FROM departments ORDER BY name');
    // Also return company info if token provided
    let company_name = null;
    const token = (req.headers['authorization']||'').split(' ')[1];
    if (token) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'attendance_secret_key_2024');
        const [uRows] = await db.execute('SELECT company_name FROM users WHERE id = ?', [decoded.id]);
        if (uRows.length > 0) company_name = uRows[0].company_name;
      } catch(e) {}
    }
    res.json({ departments: rows, company_name });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch departments.' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    if (!email || !password || !role) {
      return res.status(400).json({ error: 'Email, password and role are required.' });
    }
    const safeEmail = email.trim().toLowerCase();
    const safeRole  = ['admin', 'employee'].includes(role) ? role : null;
    if (!safeRole) return res.status(400).json({ error: 'Invalid role.' });

    const [rows] = await db.execute(
      `SELECT id, name, email, password, role, department_id FROM users WHERE email = ? AND role = ? LIMIT 1`,
      [safeEmail, safeRole]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials.' });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials.' });

    const token = jwt.sign(
      { id: user.id, role: safeRole, email: user.email, name: user.name },
      JWT_SECRET, { expiresIn: '8h' }
    );

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
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out successfully.' });
});

// ─── POST /api/auth/register ──────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role, department_id, company_name, face_descriptor, face_photo, phone, position } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const [existing] = await db.execute('SELECT id FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    if (existing.length > 0) return res.status(409).json({ error: 'Email already registered.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const userRole = ['admin','employee'].includes(role) ? role : 'employee';

    // If admin registering, create a department for their company automatically
    let deptId = department_id || null;

    const [result] = await db.execute(
      'INSERT INTO users (name, email, password, role, department_id, company_name) VALUES (?, ?, ?, ?, ?, ?)',
      [name.trim(), email.trim().toLowerCase(), hashedPassword, userRole, deptId, company_name||null]
    );

    // If employee with face data, store face descriptor in face_data table
    if (userRole === 'employee' && face_descriptor) {
      try {
        const crypto = require('crypto');
        const encKey = process.env.FACE_ENCRYPT_KEY || '0'.repeat(64);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(encKey, 'hex'), iv);
        const descriptorStr = JSON.stringify(face_descriptor);
        let encrypted = cipher.update(descriptorStr, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag();

        await db.execute(
          `INSERT INTO face_data (employee_id, face_id_encrypted, iv, auth_tag) VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE face_id_encrypted=VALUES(face_id_encrypted), iv=VALUES(iv), auth_tag=VALUES(auth_tag)`,
          [result.insertId, encrypted, iv.toString('hex'), authTag.toString('hex')]
        );
      } catch (faceErr) {
        console.warn('Face data storage failed:', faceErr.message);
      }
    }

    res.status(201).json({
      message: 'Registration successful!',
      user: { id: result.insertId, name: name.trim(), email: email.trim().toLowerCase(), role: userRole }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

// ─── POST /api/auth/change-password ──────────────────────────
router.post('/change-password', verifyToken, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.status(400).json({ error: 'All fields are required.' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const [rows] = await db.execute('SELECT password FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' });

    const valid = await bcrypt.compare(oldPassword, rows[0].password);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

    const newHash = await bcrypt.hash(newPassword, 12);
    await db.execute('UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?', [newHash, req.user.id]);

    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── GET /api/auth/me — get current user profile ─────────────
router.get('/me', verifyToken, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT u.id, u.name, u.email, u.role, u.department_id, u.company_name,
              d.name AS department_name
       FROM users u LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.id = ? LIMIT 1`,
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    
    // If employee, also get face descriptor
    let face_descriptor = null;
    if (rows[0].role === 'employee') {
      try {
        const [faceRows] = await db.execute('SELECT face_id_encrypted, iv, auth_tag FROM face_data WHERE employee_id = ?', [req.user.id]);
        if (faceRows.length > 0) {
          const crypto = require('crypto');
          const encKey = process.env.FACE_ENCRYPT_KEY || '0'.repeat(64);
          const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(encKey, 'hex'), Buffer.from(faceRows[0].iv, 'hex'));
          decipher.setAuthTag(Buffer.from(faceRows[0].auth_tag, 'hex'));
          let decrypted = decipher.update(faceRows[0].face_id_encrypted, 'hex', 'utf8');
          decrypted += decipher.final('utf8');
          face_descriptor = JSON.parse(decrypted);
        }
      } catch (e) { console.warn('Could not decrypt face descriptor:', e.message); }
    }

    res.json({ user: { ...rows[0], face_descriptor } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get profile.' });
  }
});

// ─── POST /api/auth/departments — create dept ─────────────────
router.post('/departments', verifyToken, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Department name required.' });
    const [result] = await db.execute(
      'INSERT INTO departments (name, description) VALUES (?, ?)',
      [name.trim(), description || '']
    );
    res.status(201).json({ id: result.insertId, name: name.trim() });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Department already exists.' });
    res.status(500).json({ error: 'Failed to create department.' });
  }
});

// ─── DELETE /api/auth/departments/:id ─────────────────────────
router.delete('/departments/:id', verifyToken, async (req, res) => {
  try {
    const [emps] = await db.execute('SELECT id FROM users WHERE department_id = ? LIMIT 1', [req.params.id]);
    if (emps.length > 0) return res.status(400).json({ error: 'Cannot remove: employees are enrolled.' });
    await db.execute('DELETE FROM departments WHERE id = ?', [req.params.id]);
    res.json({ message: 'Department removed.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete department.' });
  }
});

module.exports = router;
