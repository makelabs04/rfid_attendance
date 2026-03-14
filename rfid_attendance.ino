// ============================================================
// ARDUINO CODE — RFID Attendance System
// Hardware: ESP32 + RC522 RFID Reader
//
// Libraries required (install via Arduino Library Manager):
//   - MFRC522 by GithubCommunity
//   - ArduinoJson by Benoit Blanchon
//   (WiFi and HTTPClient are built-in for ESP32)
//
// Board Manager URL (if not already added):
//   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
// Board: Tools → Board → ESP32 Dev Module
// ============================================================

#include <SPI.h>
#include <MFRC522.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ── Pin Configuration (ESP32) ──────────────────────────────
// RC522 uses VSPI (default SPI bus on ESP32)
//
//  RC522 Pin  →  ESP32 Pin
//  ─────────────────────────────
//  SDA (SS)   →  GPIO 5
//  SCK        →  GPIO 18  (VSPI CLK)
//  MOSI       →  GPIO 23  (VSPI MOSI)
//  MISO       →  GPIO 19  (VSPI MISO)
//  IRQ        →  Not connected
//  GND        →  GND
//  RST        →  GPIO 4
//  3.3V       →  3.3V  ⚠️ NOT 5V — will damage RC522
//
//  Buzzer (+) →  GPIO 2   (active buzzer)
//  LED Green  →  GPIO 25  (with 330Ω resistor to GND)
//  LED Red    →  GPIO 26  (with 330Ω resistor to GND)

#define SS_PIN    5
#define RST_PIN   4
#define BUZZER    2
#define LED_GRN  25
#define LED_RED  26

// ── WiFi & Server Config ───────────────────────────────────
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* SERVER_URL    = "http://192.168.1.100:3000/rfid/scan"; // Your Node.js server IP:PORT

// ── Globals ────────────────────────────────────────────────
MFRC522 rfid(SS_PIN, RST_PIN);
String lastUID         = "";
unsigned long lastScan = 0;
const unsigned long DEBOUNCE_MS = 3000; // Ignore same card within 3 seconds

// ══ SETUP ═════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(BUZZER,  OUTPUT);
  pinMode(LED_GRN, OUTPUT);
  pinMode(LED_RED, OUTPUT);
  digitalWrite(BUZZER,  LOW);
  digitalWrite(LED_GRN, LOW);
  digitalWrite(LED_RED, LOW);

  // Init SPI and RFID
  SPI.begin();
  rfid.PCD_Init();
  delay(100);

  Serial.println("\n=============================");
  Serial.println("  RFID Attendance System");
  Serial.println("  ESP32 + RC522");
  Serial.println("=============================");
  rfid.PCD_DumpVersionToSerial();

  // Connect WiFi
  connectWiFi();
}

// ══ LOOP ══════════════════════════════════════════════════
void loop() {
  // Reconnect WiFi if dropped
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠ WiFi lost. Reconnecting...");
    connectWiFi();
  }

  // Wait for RFID card
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) {
    delay(100);
    return;
  }

  // Build UID hex string
  String uid = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();

  Serial.println("\n📡 Card scanned — UID: " + uid);

  // Debounce: skip same card scanned too quickly
  unsigned long now = millis();
  if (uid == lastUID && (now - lastScan) < DEBOUNCE_MS) {
    Serial.println("⏭ Debounce — same card, skipping.");
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    return;
  }
  lastUID  = uid;
  lastScan = now;

  // Quick beep to confirm scan detected
  buzzBeep(1, 80);

  // Send to Node.js server
  sendToServer(uid);

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}

// ══ WiFi Connect ══════════════════════════════════════════
void connectWiFi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    blinkBoth(1, 200);
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ WiFi connected!");
    Serial.println("   IP: " + WiFi.localIP().toString());
    Serial.println("   RSSI: " + String(WiFi.RSSI()) + " dBm");
    blinkGreen(3, 100);
  } else {
    Serial.println("\n❌ WiFi connection failed. Will retry...");
    blinkRed(5, 150);
  }
}

// ══ HTTP POST to Node.js ══════════════════════════════════
void sendToServer(String uid) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("❌ No WiFi — cannot send.");
    blinkRed(3, 200);
    return;
  }

  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(8000);

  // Build JSON payload
  StaticJsonDocument<128> doc;
  doc["rfid"]      = uid;
  doc["device_ip"] = WiFi.localIP().toString();
  String payload;
  serializeJson(doc, payload);

  Serial.println("📤 Sending → " + String(SERVER_URL));
  Serial.println("   Body: " + payload);

  int httpCode = http.POST(payload);
  Serial.println("   HTTP Status: " + String(httpCode));

  if (httpCode == 200) {
    String response = http.getString();
    Serial.println("   Response: " + response);

    StaticJsonDocument<256> resp;
    DeserializationError err = deserializeJson(resp, response);

    if (!err) {
      bool success      = resp["success"]   | false;
      const char* user  = resp["user"]      | "Unknown";
      const char* status= resp["status"]    | "unknown";
      const char* scan  = resp["scan_type"] | "";
      const char* msg   = resp["message"]   | "";
      const char* time  = resp["time"]      | "";

      if (success) {
        Serial.printf("✅ %s — %s [%s] at %s\n", user, status, scan, time);

        if      (strcmp(status, "present") == 0)    { blinkGreen(2, 200);  buzzBeep(1, 300); }
        else if (strcmp(status, "late")    == 0)    { blinkYellow(3, 200); buzzBeep(2, 200); }
        else if (strcmp(status, "early_leave") == 0){ blinkYellow(2, 200); buzzBeep(2, 150); }
        else                                         { blinkGreen(1, 400);  buzzBeep(1, 300); }

      } else {
        Serial.println("❌ Server rejected: " + String(msg));
        blinkRed(3, 200);
        buzzBeep(3, 100);
      }

    } else {
      Serial.println("❌ Failed to parse server response");
      blinkRed(2, 200);
    }

  } else if (httpCode < 0) {
    Serial.println("❌ Connection failed: " + http.errorToString(httpCode));
    blinkRed(5, 100);
    buzzBeep(3, 100);
  } else {
    Serial.println("❌ HTTP Error: " + String(httpCode));
    blinkRed(3, 200);
  }

  http.end();
}

// ══ LED Helpers ═══════════════════════════════════════════
void blinkGreen(int times, int ms) {
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_GRN, HIGH); delay(ms);
    digitalWrite(LED_GRN, LOW);  delay(ms);
  }
}

void blinkRed(int times, int ms) {
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_RED, HIGH); delay(ms);
    digitalWrite(LED_RED, LOW);  delay(ms);
  }
}

void blinkYellow(int times, int ms) {
  // Yellow = Red + Green on simultaneously
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_RED, HIGH); digitalWrite(LED_GRN, HIGH); delay(ms);
    digitalWrite(LED_RED, LOW);  digitalWrite(LED_GRN, LOW);  delay(ms);
  }
}

void blinkBoth(int times, int ms) { blinkYellow(times, ms); }

// ══ Buzzer Helper ═════════════════════════════════════════
void buzzBeep(int times, int ms) {
  for (int i = 0; i < times; i++) {
    digitalWrite(BUZZER, HIGH); delay(ms);
    digitalWrite(BUZZER, LOW);
    if (i < times - 1) delay(80); // gap between beeps
  }
}

// ══ WIRING SUMMARY ════════════════════════════════════════
/*
  RC522       →  ESP32
  ──────────────────────────
  SDA (SS)    →  GPIO 5
  SCK         →  GPIO 18
  MOSI        →  GPIO 23
  MISO        →  GPIO 19
  IRQ         →  (not used)
  GND         →  GND
  RST         →  GPIO 4
  VCC (3.3V)  →  3.3V  ⚠️ NOT 5V!

  BUZZER (active):
  + → GPIO 2 → Buzzer → GND

  LEDs (use 330Ω resistors):
  Green: GPIO 25 → 330Ω → LED(+) → LED(-) → GND
  Red:   GPIO 26 → 330Ω → LED(+) → LED(-) → GND

  FEEDBACK CODES:
  ──────────────────────────────────
  Green  x2 blink + 1 long beep  = Present (check-in/out)
  Yellow x3 blink + 2 beeps      = Late arrival
  Yellow x2 blink + 2 short beep = Early leave checkout
  Red    x3 blink + 3 beeps      = Unknown card / server error
  Red    x5 blink + 3 beeps      = Network error
  Green  x3 blink (startup)      = WiFi connected OK

  BEFORE UPLOADING:
  1. Install Board: ESP32 by Espressif via Boards Manager
  2. Install libraries: MFRC522, ArduinoJson
  3. Set: WIFI_SSID, WIFI_PASSWORD, SERVER_URL
  4. Tools → Board → ESP32 Dev Module
  5. Tools → Port → (your COM port)
  6. Upload & open Serial Monitor at 115200 baud
*/
