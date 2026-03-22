// ============================================================
//  routes/reportRoutes.js — Attendance Reports
// ============================================================

const express = require('express');
const router = express.Router();
const db = require('../config/database');

// ─── GET /api/reports/monthly?month=3&year=2025 ───────────────
router.get('/monthly', async (req, res) => {
  try {
    const { month, year } = req.query;
    if (!month || !year) return res.status(400).json({ error: 'month and year required.' });

    const [rows] = await db.execute(`
      SELECT
        u.id, u.name AS employee_name,
        d.name AS department_name,
        COUNT(CASE WHEN a.status = 'present' THEN 1 END) AS days_present,
        COUNT(CASE WHEN a.status = 'absent'  THEN 1 END) AS days_absent,
        COUNT(CASE WHEN a.status = 'late'    THEN 1 END) AS days_late,
        COUNT(CASE WHEN a.status = 'wfh'     THEN 1 END) AS days_wfh,
        ROUND(AVG(a.face_match_score), 1) AS avg_face_score,
        ROUND(
          SUM(TIMESTAMPDIFF(MINUTE, a.check_in_time, a.check_out_time)) / 60.0, 1
        ) AS total_hours,
        ROUND(
          (COUNT(CASE WHEN a.status IN ('present','late','wfh') THEN 1 END)
          / NULLIF(COUNT(*),0)) * 100, 1
        ) AS attendance_rate
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      LEFT JOIN attendance a ON u.id = a.user_id
        AND MONTH(a.check_in_time) = ? AND YEAR(a.check_in_time) = ?
      WHERE u.role = 'employee'
      GROUP BY u.id, u.name, d.name
      ORDER BY u.name
    `, [month, year]);

    const summary = {
      total_employees: rows.length,
      avg_attendance_rate: rows.length > 0
        ? (rows.reduce((s, r) => s + (r.attendance_rate || 0), 0) / rows.length).toFixed(1)
        : 0
    };

    res.json({ data: rows, summary, month, year });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate monthly report.' });
  }
});

// ─── GET /api/reports/daily?date=2025-03-04 ──────────────────
router.get('/daily', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const [rows] = await db.execute(`
      SELECT
        u.id, u.name,
        d.name AS department_name,
        a.check_in_time, a.check_out_time,
        a.face_match_score, a.status, a.work_type,
        a.check_in_lat, a.check_in_lng,
        TIMESTAMPDIFF(MINUTE, a.check_in_time, IFNULL(a.check_out_time, NOW())) AS minutes_worked
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      LEFT JOIN attendance a ON u.id = a.user_id AND DATE(a.check_in_time) = ?
      WHERE u.role = 'employee'
      ORDER BY COALESCE(a.check_in_time, '9999-12-31'), u.name
    `, [date]);

    const summary = {
      date,
      present: rows.filter(r => r.status === 'present').length,
      late:    rows.filter(r => r.status === 'late').length,
      absent:  rows.filter(r => !r.status || r.status === 'absent').length,
      wfh:     rows.filter(r => r.status === 'wfh').length,
    };

    res.json({ data: rows, summary });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate daily report.' });
  }
});

// ─── GET /api/reports/department-summary ──────────────────────
router.get('/department-summary', async (req, res) => {
  try {
    const { month, year } = req.query;
    const [rows] = await db.execute(`
      SELECT
        d.id, d.name AS department,
        COUNT(DISTINCT u.id) AS total_employees,
        ROUND(AVG(
          CASE WHEN a.status IN ('present','late','wfh') THEN 100 ELSE 0 END
        ), 1) AS attendance_rate,
        ROUND(AVG(a.face_match_score), 1) AS avg_face_score
      FROM departments d
      LEFT JOIN users u ON d.id = u.department_id AND u.role = 'employee'
      LEFT JOIN attendance a ON u.id = a.user_id
        AND (? IS NULL OR MONTH(a.check_in_time) = ?)
        AND (? IS NULL OR YEAR(a.check_in_time) = ?)
      GROUP BY d.id, d.name ORDER BY d.name
    `, [month||null, month||null, year||null, year||null]);

    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get department summary.' });
  }
});

module.exports = router;
