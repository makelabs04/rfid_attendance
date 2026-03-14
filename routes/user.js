// ============================================================
// routes/user.js — User: attendance history, calendar, profile
// DB connection created inside this file
// ============================================================
const express = require('express');
const router  = express.Router();
const mysql   = require('mysql2/promise');
const jwt     = require('jsonwebtoken');
const moment  = require('moment-timezone');

const DB = {
  host:     '127.0.0.1',
  user:     'u966260443_rfidNode',
  password: 'Makelabs@123',
  database: 'u966260443_rfidNode',
  waitForConnections: true,
  connectionLimit: 10
};
const pool = mysql.createPool(DB);
const JWT_SECRET = 'rfid_super_secret_key_change_me';

// ── Auth middleware ─────────────────────────────────────────
function auth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

// ── GET /api/user/monthly?month=2024-12 ────────────────────
router.get('/monthly', auth, async (req, res) => {
  const { month } = req.query; // format: YYYY-MM
  const userId = req.user.id;
  const target = month || moment().format('YYYY-MM');
  const startDate = `${target}-01`;
  const endDate   = moment(startDate).endOf('month').format('YYYY-MM-DD');

  try {
    // Get all check-in records for the month
    const [rows] = await pool.execute(
      `SELECT date, scan_type, scan_time, status, working_hours
       FROM attendance
       WHERE user_id = ? AND date BETWEEN ? AND ?
       ORDER BY date, scan_time`,
      [userId, startDate, endDate]
    );

    // Build day-by-day map
    const dayMap = {};
    rows.forEach(r => {
      const d = r.date.toISOString ? r.date.toISOString().split('T')[0] : r.date;
      if (!dayMap[d]) dayMap[d] = { date: d, check_in: null, check_out: null, status: 'absent', working_hours: 0 };
      if (r.scan_type === 'check_in') {
        dayMap[d].check_in = r.scan_time;
        dayMap[d].status   = r.status;
      }
      if (r.scan_type === 'check_out') {
        dayMap[d].check_out    = r.scan_time;
        dayMap[d].working_hours = parseFloat(r.working_hours) || 0;
        if (r.status === 'early_leave') dayMap[d].status = 'early_leave';
      }
    });

    // Build full calendar array
    const totalDays = moment(endDate).date();
    const calendar  = [];
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${target}-${String(d).padStart(2, '0')}`;
      const dow = moment(dateStr).day();
      const isWeekend = dow === 0 || dow === 6;
      calendar.push(dayMap[dateStr] || {
        date: dateStr,
        status: isWeekend ? 'weekend' : 'absent',
        check_in: null,
        check_out: null,
        working_hours: 0
      });
    }

    // Summary
    const summary = {
      present:     calendar.filter(d => d.status === 'present').length,
      late:        calendar.filter(d => d.status === 'late').length,
      absent:      calendar.filter(d => d.status === 'absent').length,
      early_leave: calendar.filter(d => d.status === 'early_leave').length,
      total_hours: calendar.reduce((a, d) => a + (d.working_hours || 0), 0).toFixed(2)
    };

    res.json({ success: true, calendar, summary, month: target });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: 'Error fetching attendance' });
  }
});

// ── GET /api/user/messages ──────────────────────────────────
router.get('/messages', auth, async (req, res) => {
  const userId = req.user.id;
  try {
    const [rows] = await pool.execute(
      `SELECT m.id, m.subject, m.body, m.sent_at, u.name AS from_name
       FROM messages m
       JOIN users u ON u.id = m.admin_id
       WHERE m.user_id = ? OR m.recipient_type = 'all'
         OR (m.recipient_type = 'department' AND m.department = (
               SELECT department FROM users WHERE id = ?))
       ORDER BY m.sent_at DESC LIMIT 50`,
      [userId, userId]
    );
    res.json({ success: true, messages: rows });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: 'Error fetching messages' });
  }
});

// ── GET /api/user/profile ───────────────────────────────────
router.get('/profile', auth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, email, mobile, department, rfid_tag, role FROM users WHERE id = ?',
      [req.user.id]
    );
    res.json({ success: true, user: rows[0] });
  } catch (err) {
    res.json({ success: false, message: 'Error' });
  }
});

// ── GET /api/user/today ─────────────────────────────────────
router.get('/today', auth, async (req, res) => {
  const today = moment().format('YYYY-MM-DD');
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM attendance WHERE user_id = ? AND date = ? ORDER BY scan_time',
      [req.user.id, today]
    );
    res.json({ success: true, records: rows });
  } catch (err) {
    res.json({ success: false, message: 'Error' });
  }
});

module.exports = router;
