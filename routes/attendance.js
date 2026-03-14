// ============================================================
// routes/attendance.js — Shared attendance queries
// DB connection created inside this file
// ============================================================
const express = require('express');
const router  = express.Router();
const mysql   = require('mysql2/promise');
const jwt     = require('jsonwebtoken');

const DB = {
  host:     '127.0.0.1',
  user:     'u966260443_rfidNode',
  password: 'Makelabs@123',
  database: 'u966260443_rfidNode',
  waitForConnections: true,
  connectionLimit: 10
};
const pool = mysql.createPool(DB);
const JWT_SECRET = '3200b5aa643fa458b7032d180c6ce909e675494bc42769e85af5ee0b038aa93b863ded77d44ad745ff6e4b9e690d8ce2df43cc3658e6d1af34d7c484624b79b9';

function auth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ success: false });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ success: false }); }
}

// GET /api/attendance/office-settings (public for display)
router.get('/office-settings', auth, async (req, res) => {
  const [rows] = await pool.execute('SELECT setting_key, setting_value FROM office_settings');
  const s = {};
  rows.forEach(r => s[r.setting_key] = r.setting_value);
  res.json({ success: true, settings: s });
});

module.exports = router;
