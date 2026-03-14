// ============================================================
// ARDUINO CODE — RFID Attendance System
// Hardware: ESP8266 (NodeMCU) or ESP32 + RC522 RFID Reader
//
// Libraries required (install via Arduino Library Manager):
//   - MFRC522 by GithubCommunity
//   - ESP8266WiFi (for NodeMCU) OR WiFi (for ESP32)
//   - ESP8266HTTPClient OR HTTPClient (for ESP32)
//   - ArduinoJson by Benoit Blanchon
// ============================================================

#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h>

// ── Uncomment ONE depending on your board ──────────────────
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
// #include <WiFi.h>         // ESP32
// #include <HTTPClient.h>   // ESP32

// ── Pin Configuration (NodeMCU ESP8266) ───────────────────
// SDA (SS) → D4  (GPIO2)  [Change to D8/GPIO15 if needed]
// SCK      → D5  (GPIO14 / CLK)
// MOSI     → D7  (GPIO13)
// MISO     → D6  (GPIO12)
// RST      → D3  (GPIO0)
// GND      → GND
// VCC 3.3V → 3.3V (NOT 5V — damages RC522)
// Buzzer   → D2  (GPIO4)  optional
// LED_R    → D0  (GPIO16) optional
// LED_G    → D1  (GPIO5)  optional

#define SS_PIN   2    // D4 on NodeMCU (GPIO2)
#define RST_PIN  0    // D3 on NodeMCU (GPIO0)
#define BUZZER   4    // D2 on NodeMCU (GPIO4)
#define LED_RED  16   // D0
#define LED_GRN  5    // D1

// ── WiFi & Server Config ───────────────────────────────────
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* SERVER_URL    = "http://192.168.1.100:3000/rfid/scan"; // Your Node.js server IP:PORT

MFRC522 rfid(SS_PIN, RST_PIN);

String lastUID    = "";
unsigned long lastScan = 0;
const unsigned long DEBOUNCE_MS = 3000; // 3 seconds between same-card scans

// ══ SETUP ═════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  SPI.begin();
  rfid.PCD_Init();

  pinMode(BUZZER,  OUTPUT);
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_GRN, OUTPUT);
  digitalWrite(LED_RED, LOW);
  digitalWrite(LED_GRN, LOW);

  // Connect to WiFi
  Serial.print("Connecting to WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); Serial.print(".");
    blinkBoth(1, 200);
  }
  Serial.println("\n✅ WiFi connected: " + WiFi.localIP().toString());
  rfid.PCD_DumpVersionToSerial();

  blinkGreen(3, 100);
  Serial.println("Ready to scan RFID...");
}

// ══ LOOP ══════════════════════════════════════════════════
void loop() {
  // Wait for card
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) {
    delay(100);
    return;
  }

  // Build UID string
  String uid = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    uid += String(rfid.uid.uidByte[i] < 0x10 ? "0" : "");
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();

  Serial.println("📡 Card UID: " + uid);

  // Debounce: same card within 3s
  unsigned long now = millis();
  if (uid == lastUID && (now - lastScan) < DEBOUNCE_MS) {
    Serial.println("⏭ Same card too fast, skipping.");
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    return;
  }
  lastUID  = uid;
  lastScan = now;

  // Send to server
  buzzBeep(1, 80);  // Quick beep on scan
  sendToServer(uid);

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}

// ══ HTTP POST to Node.js backend ══════════════════════════
void sendToServer(String uid) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("❌ WiFi disconnected. Reconnecting...");
    WiFi.reconnect();
    delay(3000);
    if (WiFi.status() != WL_CONNECTED) {
      blinkRed(5, 150);
      return;
    }
  }

  HTTPClient http;
  WiFiClient client;

  // Build JSON payload
  StaticJsonDocument<128> doc;
  doc["rfid"]      = uid;
  doc["device_ip"] = WiFi.localIP().toString();
  String payload;
  serializeJson(doc, payload);

  Serial.println("📤 Sending to: " + String(SERVER_URL));
  Serial.println("   Payload: " + payload);

  http.begin(client, SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(8000); // 8s timeout

  int httpCode = http.POST(payload);
  String response = http.getString();

  Serial.println("   HTTP Code: " + String(httpCode));
  Serial.println("   Response: " + response);

  if (httpCode == 200) {
    // Parse response
    StaticJsonDocument<256> resp;
    DeserializationError err = deserializeJson(resp, response);
    if (!err) {
      bool success = resp["success"];
      String status = resp["status"] | "unknown";
      String user   = resp["user"]   | "Unknown";
      String scan   = resp["scan_type"] | "";

      if (success) {
        Serial.println("✅ " + user + " — " + status + " (" + scan + ")");
        if (status == "present")   { blinkGreen(2, 150);  buzzBeep(1, 200); }
        else if (status == "late") { blinkYellow(3, 150); buzzBeep(2, 150); }
        else { blinkGreen(1, 300); buzzBeep(1, 200); }
      } else {
        String msg = resp["message"] | "Unknown error";
        Serial.println("❌ Server error: " + msg);
        blinkRed(3, 200);
        buzzBeep(3, 80);
      }
    } else {
      Serial.println("❌ JSON parse error");
      blinkRed(2, 200);
    }
  } else {
    Serial.println("❌ HTTP Error: " + String(httpCode));
    blinkRed(5, 100);
    buzzBeep(3, 100);
  }

  http.end();
}

// ══ LED / BUZZER HELPERS ══════════════════════════════════
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
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_RED, HIGH); digitalWrite(LED_GRN, HIGH); delay(ms);
    digitalWrite(LED_RED, LOW);  digitalWrite(LED_GRN, LOW);  delay(ms);
  }
}
void blinkBoth(int times, int ms) { blinkYellow(times, ms); }

void buzzBeep(int times, int ms) {
  for (int i = 0; i < times; i++) {
    digitalWrite(BUZZER, HIGH); delay(ms);
    digitalWrite(BUZZER, LOW);  delay(ms > 60 ? 80 : 40);
  }
}

// ══ NOTES ═════════════════════════════════════════════════
/*
  WIRING SUMMARY (NodeMCU ESP8266):
  RC522 → NodeMCU
  ─────────────────
  SDA   → D4 (GPIO2)    [Can use D8/GPIO15]
  SCK   → D5 (GPIO14)
  MOSI  → D7 (GPIO13)
  MISO  → D6 (GPIO12)
  IRQ   → Not connected
  GND   → GND
  RST   → D3 (GPIO0)
  3.3V  → 3.3V (IMPORTANT: NOT 5V)

  BUZZER (active buzzer):
  + → D2 (GPIO4)
  - → GND

  LED indicators:
  Red  (+) → 330Ω → D0 (GPIO16) → GND
  Green(+) → 330Ω → D1 (GPIO5)  → GND

  STATUS MEANINGS:
  ─────────────────────────────────────────────
  Green 2 blinks  = Present (check-in/out OK)
  Yellow 3 blinks = Late arrival
  Red 3 blinks    = Unknown card or error
  Green 1 blink   = Checkout successful

  BEFORE UPLOADING:
  1. Install libraries from Library Manager
  2. Set correct board: Tools → Board → NodeMCU 1.0
  3. Set WIFI_SSID and WIFI_PASSWORD
  4. Set SERVER_URL to your Node.js server IP
  5. Run: npx web-push generate-vapid-keys  (for push notifications)
  6. Update VAPID keys in all route files
  7. npm install && node server.js
*/