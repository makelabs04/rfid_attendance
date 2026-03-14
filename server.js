// ============================================================
// RFID ATTENDANCE SYSTEM - server.js
// Main entry point
// ============================================================
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/admin',      require('./routes/admin'));
app.use('/api/user',       require('./routes/user'));
app.use('/api/push',       require('./routes/push'));
app.use('/rfid',           require('./routes/rfid'));  // Arduino endpoint

// Serve HTML pages
app.get('/',               (req, res) => res.sendFile(path.join(__dirname, 'public/pages/login.html')));
app.get('/register',       (req, res) => res.sendFile(path.join(__dirname, 'public/pages/register.html')));
app.get('/dashboard',      (req, res) => res.sendFile(path.join(__dirname, 'public/pages/user-dashboard.html')));
app.get('/admin',          (req, res) => res.sendFile(path.join(__dirname, 'public/pages/admin-dashboard.html')));

app.listen(PORT, () => {
  console.log(`✅ RFID Attendance Server running on http://localhost:${PORT}`);
});
