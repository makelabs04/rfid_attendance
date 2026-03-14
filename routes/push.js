// ============================================================
// routes/push.js — Web Push subscription save/VAPID key
// DB connection created inside this file
// ============================================================
const express  = require('express');
const router   = express.Router();
const mysql    = require('mysql2/promise');
const jwt      = require('jsonwebtoken');
const webpush  = require('web-push');

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

function auth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ success: false });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ success: false }); }
}

// GET VAPID public key (client needs this for subscription)
router.get('/vapid-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC });
});

// POST save push subscription
router.post('/subscribe', auth, async (req, res) => {
  const { subscription } = req.body;
  try {
    await pool.execute(
      'UPDATE users SET push_subscription = ? WHERE id = ?',
      [JSON.stringify(subscription), req.user.id]
    );
    res.json({ success: true, message: 'Push subscription saved' });
  } catch (err) {
    res.json({ success: false, message: 'Error saving subscription' });
  }
});

// POST unsubscribe
router.post('/unsubscribe', auth, async (req, res) => {
  await pool.execute('UPDATE users SET push_subscription = NULL WHERE id = ?', [req.user.id]);
  res.json({ success: true });
});

module.exports = router;
