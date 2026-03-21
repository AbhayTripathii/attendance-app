const express = require('express');
const cors    = require('cors');
const path    = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));        // allow base64 images
app.use(express.urlencoded({ extended: true }));

// ─── Serve ONLY the public/ folder ───────────────────────
// SECURITY: express.static(__dirname) would expose server
// source files (database.js, .env, authRoutes.js, etc.)
// to any browser request. Serving only public/ prevents that.
app.use(express.static(path.join(__dirname, 'public')));

// ─── API Routes ───────────────────────────────────────────
const authRoutes       = require('./routes/authRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const faceRoutes       = require('./routes/faceRoutes');
const reportRoutes     = require('./routes/reportRoutes');

app.use('/api/auth',       authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/face',       faceRoutes);
app.use('/api/reports',    reportRoutes);


// ─── One-time DB Setup ────────────────────────────────────
app.get('/api/setup', async (req, res) => {
  const db = require('./config/database');
  const queries = [
    `CREATE TABLE IF NOT EXISTS departments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(150) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      role ENUM('admin','employee') NOT NULL DEFAULT 'employee',
      department_id INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_email (email),
      INDEX idx_role (role)
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS attendance (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      department_id INT,
      check_in_time DATETIME,
      check_out_time DATETIME,
      check_in_lat DECIMAL(10,7),
      check_in_lng DECIMAL(10,7),
      check_out_lat DECIMAL(10,7),
      check_out_lng DECIMAL(10,7),
      selfie_path VARCHAR(255),
      face_match_score DECIMAL(5,2),
      work_type ENUM('office','wfh','field') DEFAULT 'office',
      ip_address VARCHAR(45),
      status ENUM('present','absent','late','half-day','wfh') DEFAULT 'present',
      date DATE GENERATED ALWAYS AS (DATE(check_in_time)) STORED,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS face_data (
      id INT AUTO_INCREMENT PRIMARY KEY,
      employee_id INT NOT NULL UNIQUE,
      face_id_encrypted TEXT NOT NULL,
      iv VARCHAR(64) NOT NULL,
      auth_tag VARCHAR(64) NOT NULL,
      avg_score DECIMAL(5,2) DEFAULT 0,
      verify_count INT DEFAULT 0,
      enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_verified_at DATETIME
    ) ENGINE=InnoDB`,
    `INSERT IGNORE INTO departments (name, description) VALUES
      ('Engineering','Software development and IT'),
      ('Marketing','Marketing and sales'),
      ('HR','Human resources'),
      ('Finance','Finance and accounting'),
      ('Operations','Operations and support')`
  ];
  try {
    for (const q of queries) await db.execute(q);
    res.json({ success: true, message: 'All tables created successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ─── Health Check ─────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status:    'ok',
    timestamp: new Date().toISOString(),
    database:  'attendance_system'
  });
});

// ─── Catch-all: send index.html for any unmatched route ───
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Global Error Handler ─────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// ─── Start ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   ✅ Attendance Management System        ║
║   Server running on port ${PORT}            ║
║   http://localhost:${PORT}                  ║
╚══════════════════════════════════════════╝
  `);
});

module.exports = app;
