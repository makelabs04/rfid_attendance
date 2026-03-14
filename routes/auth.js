// ============================================================
// routes/auth.js — Register, Login, Logout
// DB connection created inside this file
// ============================================================
const express = require('express');
const router  = express.Router();
const mysql   = require('mysql2/promise');
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');

// ── DB config (edit to match your environment) ─────────────
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

// ── POST /api/auth/register ─────────────────────────────────
router.post('/register', async (req, res) => {
  const { name, email, mobile, department, password } = req.body;
  if (!name || !email || !mobile || !department || !password)
    return res.json({ success: false, message: 'All fields required' });

  try {
    const hashed = await bcrypt.hash(password, 10);
    await pool.execute(
      'INSERT INTO users (name, email, mobile, department, password, role) VALUES (?,?,?,?,?,?)',
      [name, email, mobile, department, hashed, 'user']
    );
    res.json({ success: true, message: 'Registered successfully. Admin will assign your RFID tag.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.json({ success: false, message: 'Email already registered' });
    console.error(err);
    res.json({ success: false, message: 'Server error' });
  }
});

// ── POST /api/auth/login ────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ? AND is_active = 1', [email]);
    if (!rows.length) return res.json({ success: false, message: 'User not found' });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ success: false, message: 'Invalid password' });

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
    res.cookie('token', token, { httpOnly: true, maxAge: 8 * 3600 * 1000 });
    res.json({ success: true, role: user.role, name: user.name });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: 'Server error' });
  }
});

// ── POST /api/auth/logout ───────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

// ── GET /api/auth/me ────────────────────────────────────────
router.get('/me', async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.json({ loggedIn: false });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const [rows] = await pool.execute(
      'SELECT id, name, email, mobile, department, role, rfid_tag FROM users WHERE id = ?',
      [decoded.id]
    );
    if (!rows.length) return res.json({ loggedIn: false });
    res.json({ loggedIn: true, user: rows[0] });
  } catch {
    res.json({ loggedIn: false });
  }
});

module.exports = router;
