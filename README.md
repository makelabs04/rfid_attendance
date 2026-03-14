# RFID Attendance System — Setup Guide

## File Structure
```
rfid-attendance/
├── server.js                  ← Main entry point
├── package.json
├── database.sql               ← Run this first in MySQL
├── routes/
│   ├── auth.js                ← Login, Register, Logout
│   ├── rfid.js                ← Arduino scan endpoint + attendance insert
│   ├── user.js                ← User: calendar, monthly attendance, messages
│   ├── admin.js               ← Admin: users, attendance, messages, settings
│   ├── attendance.js          ← Shared queries
│   └── push.js                ← Web push subscription
├── public/
│   ├── sw.js                  ← Service worker (push notifications)
│   └── pages/
│       ├── login.html         ← Login + Register page
│       ├── user-dashboard.html← User: calendar, stats, messages
│       └── admin-dashboard.html← Admin: full management panel
└── arduino/
    └── rfid_attendance.ino    ← ESP8266/ESP32 + RC522 code
```

## Step 1 — MySQL Setup
```sql
mysql -u root -p < database.sql
```
Then update the default admin password:
```sql
USE rfid_attendance;
-- Replace hash below with bcrypt hash of your desired password
-- Generate with: node -e "const b=require('bcrypt');b.hash('YourPass',10,(e,h)=>console.log(h))"
UPDATE users SET password='$2b$10$...' WHERE email='admin@company.com';
```

## Step 2 — Generate VAPID Keys (Push Notifications)
```bash
npx web-push generate-vapid-keys
```
Copy the Public and Private keys.
Replace `YOUR_VAPID_PUBLIC_KEY` and `YOUR_VAPID_PRIVATE_KEY` in:
- `routes/rfid.js`
- `routes/admin.js`
- `routes/push.js`

## Step 3 — Configure Database Password
In every file under `routes/`, change:
```js
password: 'your_db_password',
```
to your actual MySQL root or user password.

## Step 4 — Install & Run
```bash
npm install
node server.js
# OR for development:
npx nodemon server.js
```
Open: http://localhost:3000

## Step 5 — Arduino Setup
1. Open `arduino/rfid_attendance.ino` in Arduino IDE
2. Install libraries: MFRC522, ArduinoJson, ESP8266WiFi + ESP8266HTTPClient
3. Set your WiFi credentials and server IP inside the .ino file
4. Board: Tools → NodeMCU 1.0 (ESP-12E Module)
5. Upload and open Serial Monitor (115200 baud)

## Admin First Login
- Email: `admin@company.com`
- Password: `Admin@1234` (change immediately after login!)

## API Endpoints Summary

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/auth/register | Register new user |
| POST | /api/auth/login | Login |
| POST | /api/auth/logout | Logout |
| GET  | /api/auth/me | Current session |
| POST | /rfid/scan | **Arduino posts here** |
| GET  | /api/user/monthly?month=YYYY-MM | User monthly calendar |
| GET  | /api/user/today | Today's attendance |
| GET  | /api/user/messages | User messages |
| GET  | /api/admin/attendance/today-summary | Dashboard summary |
| GET  | /api/admin/attendance | Filter attendance |
| POST | /api/admin/attendance/manual | Manual entry |
| GET  | /api/admin/users | All employees |
| POST | /api/admin/users/:id/rfid | Assign RFID |
| PUT  | /api/admin/users/:id | Update user |
| DELETE | /api/admin/users/:id | Delete user |
| POST | /api/admin/messages | Send message + push |
| GET  | /api/admin/settings | Get office settings |
| PUT  | /api/admin/settings | Update office settings |
| GET  | /api/push/vapid-key | VAPID public key |
| POST | /api/push/subscribe | Save push subscription |

## Attendance Status Logic
- **Present** = checked in before (office_start + late_threshold_minutes)
- **Late** = checked in after the threshold
- **Early Leave** = checked out before (office_end - early_leave_threshold_minutes)
- **Absent** = no check-in for the day

## Security Notes
- Change JWT_SECRET in all route files to a long random string
- Use HTTPS in production (SSL certificate)
- Change default admin credentials immediately
- Store sensitive config in .env (use dotenv package) in production
