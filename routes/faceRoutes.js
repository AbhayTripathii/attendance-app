// ============================================================
//  routes/faceRoutes.js — Face Recognition API Integration
// ============================================================

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const crypto = require('crypto');

/**
 * Face Recognition Integration
 * Uses a configurable Face API (e.g., AWS Rekognition, Microsoft Azure Face API,
 * FaceIO, DeepFace, or custom Python model via HTTP).
 *
 * Environment variables:
 *   FACE_API_URL      — API base URL
 *   FACE_API_KEY      — API key
 *   FACE_MATCH_THRESHOLD — Min confidence % (default 85)
 */

// ─── Simulated Face API Client ────────────────────────────────
// In production, replace with real API calls (AWS Rekognition, Azure, etc.)
async function callFaceAPI(action, payload) {
  const apiUrl = process.env.FACE_API_URL;
  if (!apiUrl) {
    // Simulation mode
    if (action === 'enroll')  return { success: true, face_id: crypto.randomUUID() };
    if (action === 'verify')  return { match: true, score: 94 + Math.random() * 5 };
    if (action === 'detect')  return { faces_detected: 1, confidence: 0.99 };
  }

  const res = await fetch(`${apiUrl}/${action}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.FACE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

// ─── POST /api/face/enroll — Register face for employee ──────
router.post('/enroll', async (req, res) => {
  try {
    const { employee_id, image_base64 } = req.body;
    if (!employee_id || !image_base64)
      return res.status(400).json({ error: 'employee_id and image_base64 required.' });

    // Check employee exists
    const [emp] = await db.execute('SELECT id, name FROM employees WHERE id = ? AND is_active = 1', [employee_id]);
    if (emp.length === 0) return res.status(404).json({ error: 'Employee not found.' });

    // Detect face first
    const detection = await callFaceAPI('detect', { image: image_base64 });
    if (detection.faces_detected === 0) return res.status(400).json({ error: 'No face detected in image.' });
    if (detection.faces_detected > 1)  return res.status(400).json({ error: 'Multiple faces detected. Use single-face photo.' });

    // Enroll face
    const enrollment = await callFaceAPI('enroll', { image: image_base64, metadata: { employee_id } });
    if (!enrollment.success) return res.status(400).json({ error: 'Face enrollment failed.' });

    // Encrypt face ID before storage
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm',
      Buffer.from(process.env.FACE_ENCRYPT_KEY || '0'.repeat(64), 'hex'), iv);
    let encrypted = cipher.update(enrollment.face_id, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    // Save to DB (upsert)
    await db.execute(`
      INSERT INTO face_data (employee_id, face_id_encrypted, iv, auth_tag, enrolled_at)
      VALUES (?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE face_id_encrypted = ?, iv = ?, auth_tag = ?, enrolled_at = NOW()
    `, [employee_id, encrypted, iv.toString('hex'), authTag.toString('hex'),
        encrypted, iv.toString('hex'), authTag.toString('hex')]);

    res.status(201).json({ message: `Face enrolled for ${emp[0].name}.`, employee_id });
  } catch (err) {
    console.error('Face enroll error:', err);
    res.status(500).json({ error: 'Face enrollment failed.' });
  }
});

// ─── POST /api/face/verify — Verify face at check-in ─────────
router.post('/verify', async (req, res) => {
  try {
    const { employee_id, image_base64 } = req.body;
    if (!employee_id || !image_base64)
      return res.status(400).json({ error: 'employee_id and image_base64 required.' });

    // Get stored face data
    const [faceRows] = await db.execute(
      'SELECT * FROM face_data WHERE employee_id = ?', [employee_id]
    );
    if (faceRows.length === 0)
      return res.status(404).json({ error: 'No face data enrolled. Please enroll first.' });

    // Decrypt stored face ID
    const { face_id_encrypted, iv, auth_tag } = faceRows[0];
    const decipher = crypto.createDecipheriv('aes-256-gcm',
      Buffer.from(process.env.FACE_ENCRYPT_KEY || '0'.repeat(64), 'hex'),
      Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(auth_tag, 'hex'));
    let decrypted = decipher.update(face_id_encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    // Call face API to compare
    const result = await callFaceAPI('verify', {
      image: image_base64,
      reference_face_id: decrypted
    });

    const threshold = parseFloat(process.env.FACE_MATCH_THRESHOLD || 85);

    // Update last_verified and avg_score
    await db.execute(
      `UPDATE face_data SET last_verified_at = NOW(),
       avg_score = (avg_score * verify_count + ?) / (verify_count + 1),
       verify_count = verify_count + 1
       WHERE employee_id = ?`,
      [result.score, employee_id]
    );

    res.json({
      match: result.match && result.score >= threshold,
      score: Math.round(result.score),
      threshold,
      message: result.match && result.score >= threshold
        ? 'Identity verified successfully.'
        : `Face match failed (score: ${Math.round(result.score)}%, required: ${threshold}%)`
    });
  } catch (err) {
    console.error('Face verify error:', err);
    res.status(500).json({ error: 'Face verification failed.' });
  }
});

// ─── GET /api/face — List enrolled faces (Admin) ─────────────
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT fd.id, fd.employee_id, fd.enrolled_at, fd.last_verified_at,
             fd.avg_score, fd.verify_count,
             e.name AS employee_name, e.emp_code
      FROM face_data fd JOIN employees e ON fd.employee_id = e.id
      ORDER BY fd.enrolled_at DESC
    `);
    res.json({ data: rows });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch face data.' }); }
});

// ─── DELETE /api/face/:employeeId — Remove face data ─────────
router.delete('/:employeeId', async (req, res) => {
  try {
    await db.execute('DELETE FROM face_data WHERE employee_id = ?', [req.params.employeeId]);
    res.json({ message: 'Face data deleted.' });
  } catch (err) { res.status(500).json({ error: 'Failed to delete face data.' }); }
});

module.exports = router;
