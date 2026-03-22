// ============================================================
//  routes/attendanceRoutes.js
// ============================================================

const express = require('express');
const router = express.Router();
const db = require('../config/database');
// const { verifyToken, requireAdmin } = require('../middleware/authMiddleware');

// ─── GET /api/attendance — All records (Admin) ────────────────
router.get('/', async (req, res) => {
  try {
    const { date, dept_id, status, user_id, month, year } = req.query;
    let query = `
      SELECT
        a.id, a.user_id, a.date, a.check_in_time, a.check_out_time,
        a.check_in_lat, a.check_in_lng, a.check_out_lat, a.check_out_lng,
        a.status, a.face_match_score, a.work_type,
        u.name AS user_name, u.email,
        d.name AS department_name
      FROM attendance a
      JOIN users u ON a.user_id = u.id
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE 1=1
    `;
    const params = [];
    if (date)    { query += ' AND DATE(a.check_in_time) = ?'; params.push(date); }
    if (dept_id) { query += ' AND u.department_id = ?'; params.push(dept_id); }
    if (status)  { query += ' AND a.status = ?'; params.push(status); }
    if (user_id) { query += ' AND a.user_id = ?'; params.push(user_id); }
    if (month)   { query += ' AND MONTH(a.check_in_time) = ?'; params.push(month); }
    if (year)    { query += ' AND YEAR(a.check_in_time) = ?'; params.push(year); }
    query += ' ORDER BY a.check_in_time DESC LIMIT 500';

    const [rows] = await db.execute(query, params);
    res.json({ data: rows, count: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch attendance.' });
  }
});

// ─── GET /api/attendance/today — Today's summary ─────────────
router.get('/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // BUG FIX: was querying non-existent 'employees' table and 'employee_id' column.
    // Schema uses the 'users' table with a 'user_id' foreign key in attendance.
    // Also fixed: 'is_active' does not exist on users — removed that filter.
    const [rows] = await db.execute(`
      SELECT
        COUNT(DISTINCT u.id) AS total_employees,
        SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN a.status = 'absent'  THEN 1 ELSE 0 END) AS absent,
        SUM(CASE WHEN a.status = 'late'    THEN 1 ELSE 0 END) AS late,
        SUM(CASE WHEN a.status = 'wfh'     THEN 1 ELSE 0 END) AS wfh
      FROM users u
      LEFT JOIN attendance a ON u.id = a.user_id AND DATE(a.check_in_time) = ?
      WHERE u.role = 'employee'
    `, [today]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch today summary.' });
  }
});

// ─── GET /api/attendance/employee/:id — Employee history ─────
router.get('/employee/:id', async (req, res) => {
  try {
    // BUG FIX: was filtering by 'employee_id' — correct column is 'user_id'
    const [rows] = await db.execute(`
      SELECT * FROM attendance WHERE user_id = ?
      ORDER BY check_in_time DESC LIMIT 100
    `, [req.params.id]);
    res.json({ data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch employee attendance.' });
  }
});

// ─── POST /api/attendance/checkin — Mark IN ──────────────────
router.post('/checkin', async (req, res) => {
  try {
    const {
      user_id, latitude, longitude, face_match_score,
      selfie_base64, work_type = 'office', ip_address
    } = req.body;

    if (!user_id || !latitude || !longitude)
      return res.status(400).json({ error: 'user_id, latitude, longitude required.' });

    // BUG FIX: face_match_score could be undefined/null, making the comparison
    // silently pass. Now we explicitly require it to be a valid number.
    const score = parseFloat(face_match_score);
    if (isNaN(score)) {
      return res.status(400).json({ error: 'face_match_score is required and must be a number.' });
    }

    const threshold = parseFloat(process.env.FACE_MATCH_THRESHOLD || 85);
    if (score < threshold)
      return res.status(400).json({ error: `Face match too low (${score}%). Min: ${threshold}%` });

    const today = new Date().toISOString().split('T')[0];

    // BUG FIX: was using 'employee_id' — correct column is 'user_id'
    const [existing] = await db.execute(
      'SELECT id FROM attendance WHERE user_id = ? AND DATE(check_in_time) = ?',
      [user_id, today]
    );
    if (existing.length > 0)
      return res.status(409).json({ error: 'Already checked in today.' });

    // Determine status (late if after office_start + late_threshold)
    const now = new Date();
    const officeStart = process.env.OFFICE_START_TIME || '09:00';
    const lateMinutes = parseInt(process.env.LATE_THRESHOLD_MINUTES || 15);
    const [h, m] = officeStart.split(':').map(Number);
    const officeStartMs = new Date(now).setHours(h, m + lateMinutes, 0, 0);
    const status = now > officeStartMs ? 'late' : 'present';

    // Save selfie path (in prod: upload to S3/storage, store the returned path)
    let selfiePath = null;
    if (selfie_base64) {
      selfiePath = `selfies/${user_id}_${Date.now()}.jpg`;
      // await saveBase64Image(selfie_base64, selfiePath);
    }

    const [result] = await db.execute(`
      INSERT INTO attendance
        (user_id, check_in_time, check_in_lat, check_in_lng,
         face_match_score, selfie_path, work_type, status, ip_address)
      VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?)
    `, [user_id, latitude, longitude, score, selfiePath, work_type, status, ip_address || req.ip]);

    res.status(201).json({
      message: 'Check-in recorded successfully.',
      attendance_id: result.insertId,
      status,
      time: now.toISOString()
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record check-in.' });
  }
});

// ─── PUT /api/attendance/checkout/:id — Mark OUT ─────────────
router.put('/checkout/:id', async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const { id } = req.params;

    const [existing] = await db.execute(
      'SELECT * FROM attendance WHERE id = ?', [id]
    );
    if (existing.length === 0)
      return res.status(404).json({ error: 'Attendance record not found.' });
    if (existing[0].check_out_time)
      return res.status(409).json({ error: 'Already checked out.' });

    await db.execute(
      'UPDATE attendance SET check_out_time = NOW(), check_out_lat = ?, check_out_lng = ? WHERE id = ?',
      [latitude, longitude, id]
    );

    res.json({ message: 'Check-out recorded.', time: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record check-out.' });
  }
});


// ─── GET /api/attendance/employees — All employees list ──────
router.get('/employees', async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT u.id, u.name, u.email, u.department_id, u.created_at,
             d.name AS department_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.role = 'employee'
      ORDER BY u.name
    `);
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch employees.' });
  }
});

module.exports = router;
