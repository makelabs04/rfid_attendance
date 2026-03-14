-- ============================================================
-- RFID ATTENDANCE SYSTEM - Full Database Schema
-- Run this on a fresh MySQL database named: rfid_attendance
-- ============================================================

CREATE DATABASE IF NOT EXISTS rfid_attendance;
USE rfid_attendance;

-- -------------------------------------------------------
-- USERS TABLE
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  mobile VARCHAR(15) NOT NULL,
  department VARCHAR(100) NOT NULL,
  rfid_tag VARCHAR(50) UNIQUE,
  password VARCHAR(255) NOT NULL,
  role ENUM('user','admin') DEFAULT 'user',
  push_subscription TEXT,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------------------------------------
-- OFFICE SETTINGS TABLE
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS office_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  setting_value VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Default office time settings
INSERT IGNORE INTO office_settings (setting_key, setting_value) VALUES
  ('office_start', '09:00'),
  ('office_end', '18:00'),
  ('late_threshold_minutes', '15'),
  ('early_leave_threshold_minutes', '30'),
  ('office_name', 'My Company'),
  ('timezone', 'Asia/Kolkata');

-- -------------------------------------------------------
-- ATTENDANCE TABLE
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  rfid_tag VARCHAR(50) NOT NULL,
  scan_type ENUM('check_in','check_out') NOT NULL,
  scan_time DATETIME NOT NULL,
  status ENUM('present','late','early_leave','absent') DEFAULT 'present',
  working_hours DECIMAL(5,2) DEFAULT NULL,
  date DATE NOT NULL,
  ip_address VARCHAR(50),
  notes TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- -------------------------------------------------------
-- MESSAGES TABLE
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL,
  recipient_type ENUM('all','department','individual') DEFAULT 'individual',
  department VARCHAR(100),
  user_id INT,
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  status_filter ENUM('present','late','absent','early_leave','all') DEFAULT 'all',
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- -------------------------------------------------------
-- NOTIFICATIONS LOG TABLE
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  type ENUM('check_in','check_out','message','absent_alert','late_alert') NOT NULL,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- -------------------------------------------------------
-- ALTER COMMANDS (run if upgrading existing database)
-- -------------------------------------------------------
-- ALTER TABLE users ADD COLUMN push_subscription TEXT AFTER role;
-- ALTER TABLE users ADD COLUMN is_active TINYINT(1) DEFAULT 1 AFTER push_subscription;
-- ALTER TABLE attendance ADD COLUMN working_hours DECIMAL(5,2) DEFAULT NULL AFTER status;
-- ALTER TABLE attendance ADD COLUMN ip_address VARCHAR(50) AFTER date;
-- ALTER TABLE attendance ADD COLUMN notes TEXT AFTER ip_address;
-- ALTER TABLE messages ADD COLUMN status_filter ENUM('present','late','absent','early_leave','all') DEFAULT 'all' AFTER sent_at;
-- ALTER TABLE office_settings ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- -------------------------------------------------------
-- DEFAULT ADMIN USER (password: Admin@1234)
-- Change after first login!
-- -------------------------------------------------------
INSERT IGNORE INTO users (name, email, mobile, department, password, role)
VALUES ('System Admin', 'admin@company.com', '9999999999', 'Administration',
        '$2b$10$YourHashedPasswordHere', 'admin');
