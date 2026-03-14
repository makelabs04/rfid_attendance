// ============================================================
// routes/rfid.js — Arduino posts RFID scans here
// DB connection created inside this file
// ============================================================
const express   = require('express');
const router    = express.Router();
const mysql     = require('mysql2/promise');
const webpush   = require('web-push');
const moment    = require('moment-timezone');

// ── DB config ───────────────────────────────────────────────
const DB = {
  host:     '127.0.0.1',
  user:     'u966260443_rfidNode',
  password: 'Makelabs@123',
  database: 'u966260443_rfidNode',
  waitForConnections: true,
  connectionLimit: 10
};
const pool = mysql.createPool(DB);

// ── Web Push VAPID keys (generate once with: npx web-push generate-vapid-keys)
const VAPID_PUBLIC  = 'BEjJfap-EDNq88uLNifPepC3M8bGnPHzq0IM9VYm82JYtlA3Ttqr6tTnxdANaKYYjUJPb6TfMCgyb79LqsORr3U';
const VAPID_PRIVATE = 'BpvQkJM8UHFxtifQvEX_SiSQi3A2l0M0NPOglu-h7Tk';
webpush.setVapidDetails('mailto:admin@company.com', VAPID_PUBLIC, VAPID_PRIVATE);

// ── Helper: get office settings ─────────────────────────────
async function getSettings() {
  const [rows] = await pool.execute('SELECT setting_key, setting_value FROM office_settings');
  const s = {};
  rows.forEach(r => s[r.setting_key] = r.setting_value);
  return s;
}

// ── Helper: send push notification to user ──────────────────
async function sendPush(userId, title, body, type) {
  try {
    const [rows] = await pool.execute('SELECT push_subscription FROM users WHERE id = ?', [userId]);
    if (!rows.length || !rows[0].push_subscription) return;
    const sub = JSON.parse(rows[0].push_subscription);
    await webpush.sendNotification(sub, JSON.stringify({ title, body }));
    await pool.execute(
      'INSERT INTO notification_log (user_id, title, body, type) VALUES (?,?,?,?)',
      [userId, title, body, type]
    );
  } catch (e) {
    console.error('Push error:', e.message);
  }
}

// ── POST /rfid/scan ─────────────────────────────────────────
// Arduino sends: { rfid: "ABCD1234", device_ip: "192.168.1.x" }
router.post('/scan', async (req, res) => {
  const { rfid, device_ip } = req.body;
  if (!rfid) return res.json({ success: false, message: 'No RFID tag provided' });

  try {
    // 1. Find user by RFID
    const [users] = await pool.execute(
      'SELECT id, name, department FROM users WHERE rfid_tag = ? AND is_active = 1',
      [rfid]
    );
    if (!users.length) {
      return res.json({ success: false, message: 'Unknown RFID tag' });
    }
    const user = users[0];

    // 2. Get office settings
    const settings  = await getSettings();
    const tz        = settings.timezone || 'Asia/Kolkata';
    const now       = moment().tz(tz);
    const today     = now.format('YYYY-MM-DD');
    const timeNow   = now.format('HH:mm');
    const startTime = settings.office_start || '09:00';
    const endTime   = settings.office_end   || '18:00';
    const lateMin   = parseInt(settings.late_threshold_minutes  || 15);
    const earlyMin  = parseInt(settings.early_leave_threshold_minutes || 30);

    // 3. Check if already checked-in today
    const [existing] = await pool.execute(
      'SELECT * FROM attendance WHERE user_id = ? AND date = ? ORDER BY scan_time DESC LIMIT 1',
      [user.id, today]
    );

    let scanType, status, message, pushTitle, pushBody, pushType;

    if (!existing.length || existing[0].scan_type === 'check_out') {
      // ─ CHECK IN ─
      scanType = 'check_in';
      const officeStart = moment.tz(`${today} ${startTime}`, tz);
      const lateDeadline = officeStart.clone().add(lateMin, 'minutes');

      if (now.isAfter(lateDeadline)) {
        status = 'late';
        message = `Late check-in for ${user.name}`;
        pushTitle = '⚠️ Late Check-In';
        pushBody  = `You checked in at ${timeNow}. Office started at ${startTime}.`;
        pushType  = 'late_alert';
      } else {
        status = 'present';
        message = `Check-in successful for ${user.name}`;
        pushTitle = '✅ Checked In';
        pushBody  = `Good morning ${user.name}! Checked in at ${timeNow}.`;
        pushType  = 'check_in';
      }

      await pool.execute(
        'INSERT INTO attendance (user_id, rfid_tag, scan_type, scan_time, status, date, ip_address) VALUES (?,?,?,?,?,?,?)',
        [user.id, rfid, scanType, now.toDate(), status, today, device_ip || null]
      );

    } else if (existing[0].scan_type === 'check_in') {
      // ─ CHECK OUT ─
      scanType = 'check_out';
      const officeEnd    = moment.tz(`${today} ${endTime}`, tz);
      const earlyDeadline = officeEnd.clone().subtract(earlyMin, 'minutes');
      const checkInTime   = moment(existing[0].scan_time).tz(tz);
      const workingHours  = now.diff(checkInTime, 'minutes') / 60;

      if (now.isBefore(earlyDeadline)) {
        status = 'early_leave';
        message = `Early leave for ${user.name}`;
        pushTitle = '🏃 Early Leave';
        pushBody  = `You left at ${timeNow}. Working hours: ${workingHours.toFixed(2)}h`;
        pushType  = 'check_out';
      } else {
        status = existing[0].status; // keep check-in status (present/late)
        message = `Check-out successful for ${user.name}`;
        pushTitle = '👋 Checked Out';
        pushBody  = `See you tomorrow! Working hours: ${workingHours.toFixed(2)}h`;
        pushType  = 'check_out';
      }

      // Update check-in record with working hours, then insert check-out
      await pool.execute(
        'UPDATE attendance SET working_hours = ? WHERE id = ?',
        [workingHours.toFixed(2), existing[0].id]
      );
      await pool.execute(
        'INSERT INTO attendance (user_id, rfid_tag, scan_type, scan_time, status, date, ip_address, working_hours) VALUES (?,?,?,?,?,?,?,?)',
        [user.id, rfid, 'check_out', now.toDate(), status, today, device_ip || null, workingHours.toFixed(2)]
      );
    }

    // 4. Send push notification
    await sendPush(user.id, pushTitle, pushBody, pushType);

    res.json({ success: true, message, user: user.name, scan_type: scanType, status, time: timeNow });

  } catch (err) {
    console.error('RFID scan error:', err);
    res.json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
