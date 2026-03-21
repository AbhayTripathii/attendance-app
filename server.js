// ============================================================
//  Attendance Management System — server.js
//  Entry point. Run with: node server.js
// ============================================================

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
