// ============================================================
// routes/admin.js — Admin: users, attendance, settings, messages
// DB connection created inside this file
// ============================================================
const express  = require('express');
const router   = express.Router();
const mysql    = require('mysql2/promise');
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const webpush  = require('web-push');
const moment   = require('moment-timezone');

const DB = {
  host:     '127.0.0.1',
  user:     'u966260443_rfidNode',
  password: 'Makelabs@123',
  database: 'u966260443_rfidNode',
  waitForConnections: true,
  connectionLimit: 10
};
const pool = mysql.createPool(DB);
const JWT_SECRET    = 'rfid_super_secret_key_change_me';
const VAPID_PUBLIC  = 'BEjJfap-EDNq88uLNifPepC3M8bGnPHzq0IM9VYm82JYtlA3Ttqr6tTnxdANaKYYjUJPb6TfMCgyb79LqsORr3U';
const VAPID_PRIVATE = 'BpvQkJM8UHFxtifQvEX_SiSQi3A2l0M0NPOglu-h7Tk';
webpush.setVapidDetails('mailto:admin@company.com', VAPID_PUBLIC, VAPID_PRIVATE);

// ── Admin Auth Middleware ───────────────────────────────────
function adminAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

// ══ USER MANAGEMENT ════════════════════════════════════════

// GET all users
router.get('/users', adminAuth, async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT id, name, email, mobile, department, rfid_tag, role, is_active, created_at FROM users ORDER BY created_at DESC'
  );
  res.json({ success: true, users: rows });
});

// POST assign RFID tag to user
router.post('/users/:id/rfid', adminAuth, async (req, res) => {
  const { rfid_tag } = req.body;
  try {
    await pool.execute('UPDATE users SET rfid_tag = ? WHERE id = ?', [rfid_tag, req.params.id]);
    res.json({ success: true, message: 'RFID tag assigned' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.json({ success: false, message: 'RFID tag already in use' });
    res.json({ success: false, message: 'Error' });
  }
});

// PUT update user
router.put('/users/:id', adminAuth, async (req, res) => {
  const { name, email, mobile, department, role, is_active } = req.body;
  try {
    await pool.execute(
      'UPDATE users SET name=?, email=?, mobile=?, department=?, role=?, is_active=? WHERE id=?',
      [name, email, mobile, department, role, is_active, req.params.id]
    );
    res.json({ success: true, message: 'User updated' });
  } catch (err) {
    res.json({ success: false, message: 'Error updating user' });
  }
});

// DELETE user
router.delete('/users/:id', adminAuth, async (req, res) => {
  await pool.execute('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'User deleted' });
});

// ══ ATTENDANCE MANAGEMENT ══════════════════════════════════

// GET all users attendance for a date or month
router.get('/attendance', adminAuth, async (req, res) => {
  const { date, month, department } = req.query;
  let query = `
    SELECT a.*, u.name, u.department, u.email
    FROM attendance a
    JOIN users u ON u.id = a.user_id
    WHERE 1=1
  `;
  const params = [];
  if (date)       { query += ' AND a.date = ?';              params.push(date); }
  if (month)      { query += ' AND DATE_FORMAT(a.date,"%Y-%m") = ?'; params.push(month); }
  if (department) { query += ' AND u.department = ?';        params.push(department); }
  query += ' ORDER BY a.date DESC, a.scan_time DESC';

  try {
    const [rows] = await pool.execute(query, params);
    res.json({ success: true, records: rows });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: 'Error' });
  }
});

// GET today's summary
router.get('/attendance/today-summary', adminAuth, async (req, res) => {
  const today = moment().format('YYYY-MM-DD');
  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.department, u.email,
              MAX(CASE WHEN a.scan_type='check_in'  THEN a.scan_time END) AS check_in,
              MAX(CASE WHEN a.scan_type='check_out' THEN a.scan_time END) AS check_out,
              MAX(a.status) AS status,
              MAX(a.working_hours) AS working_hours
       FROM users u
       LEFT JOIN attendance a ON a.user_id = u.id AND a.date = ?
       WHERE u.role = 'user' AND u.is_active = 1
       GROUP BY u.id, u.name, u.department, u.email`,
      [today]
    );
    // Mark null-status as absent
    const result = rows.map(r => ({ ...r, status: r.status || 'absent' }));
    res.json({ success: true, records: result, date: today });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: 'Error' });
  }
});

// POST manual attendance (admin override)
router.post('/attendance/manual', adminAuth, async (req, res) => {
  const { user_id, date, scan_type, scan_time, status, notes } = req.body;
  try {
    await pool.execute(
      'INSERT INTO attendance (user_id, rfid_tag, scan_type, scan_time, status, date, notes) VALUES (?,?,?,?,?,?,?)',
      [user_id, 'MANUAL', scan_type, scan_time, status, date, notes || 'Manual entry by admin']
    );
    res.json({ success: true, message: 'Attendance recorded' });
  } catch (err) {
    res.json({ success: false, message: 'Error' });
  }
});

// DELETE attendance record
router.delete('/attendance/:id', adminAuth, async (req, res) => {
  await pool.execute('DELETE FROM attendance WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Record deleted' });
});

// ══ MESSAGES ═══════════════════════════════════════════════

// POST send message / push notification
router.post('/messages', adminAuth, async (req, res) => {
  const { recipient_type, department, user_id, subject, body, status_filter, date } = req.body;
  const adminId = req.user.id;

  try {
    // Save message
    await pool.execute(
      'INSERT INTO messages (admin_id, recipient_type, department, user_id, subject, body, status_filter) VALUES (?,?,?,?,?,?,?)',
      [adminId, recipient_type, department || null, user_id || null, subject, body, status_filter || 'all']
    );

    // Find target users
    let userQuery = 'SELECT id, push_subscription FROM users WHERE role="user" AND is_active=1';
    const params  = [];

    if (recipient_type === 'individual' && user_id) {
      userQuery += ' AND id = ?';
      params.push(user_id);
    } else if (recipient_type === 'department' && department) {
      userQuery += ' AND department = ?';
      params.push(department);
    }

    // Filter by attendance status for the given date
    if (status_filter && status_filter !== 'all' && date) {
      if (status_filter === 'absent') {
        userQuery += ` AND id NOT IN (SELECT DISTINCT user_id FROM attendance WHERE date = '${date}')`;
      } else {
        userQuery += ` AND id IN (SELECT DISTINCT user_id FROM attendance WHERE date = '${date}' AND status = '${status_filter}')`;
      }
    }

    const [users] = await pool.execute(userQuery, params);

    // Send push to each
    let pushSent = 0;
    for (const u of users) {
      if (!u.push_subscription) continue;
      try {
        const sub = JSON.parse(u.push_subscription);
        await webpush.sendNotification(sub, JSON.stringify({ title: subject, body }));
        await pool.execute(
          'INSERT INTO notification_log (user_id, title, body, type) VALUES (?,?,?,?)',
          [u.id, subject, body, 'message']
        );
        pushSent++;
      } catch {}
    }

    res.json({ success: true, message: `Message sent. Push notifications: ${pushSent}/${users.length}` });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: 'Error sending message' });
  }
});

// GET all messages
router.get('/messages', adminAuth, async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT m.*, u.name AS admin_name FROM messages m
     JOIN users u ON u.id = m.admin_id
     ORDER BY m.sent_at DESC`
  );
  res.json({ success: true, messages: rows });
});

// DELETE message
router.delete('/messages/:id', adminAuth, async (req, res) => {
  await pool.execute('DELETE FROM messages WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Message deleted' });
});

// ══ OFFICE SETTINGS ════════════════════════════════════════

// GET settings
router.get('/settings', adminAuth, async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM office_settings');
  const settings = {};
  rows.forEach(r => settings[r.setting_key] = r.setting_value);
  res.json({ success: true, settings });
});

// PUT update settings
router.put('/settings', adminAuth, async (req, res) => {
  const updates = req.body; // { office_start: '09:00', office_end: '18:00', ... }
  try {
    for (const [key, value] of Object.entries(updates)) {
      await pool.execute(
        'INSERT INTO office_settings (setting_key, setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=?',
        [key, value, value]
      );
    }
    res.json({ success: true, message: 'Settings updated' });
  } catch (err) {
    res.json({ success: false, message: 'Error updating settings' });
  }
});

// ══ DEPARTMENTS ════════════════════════════════════════════
router.get('/departments', adminAuth, async (req, res) => {
  const [rows] = await pool.execute('SELECT DISTINCT department FROM users WHERE is_active=1');
  res.json({ success: true, departments: rows.map(r => r.department) });
});

module.exports = router;
