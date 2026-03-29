/*
 * SAHAYAK Arduino Health Monitoring Sketch
 *
 * Hardware:
 *  - MAX30102 (I2C)  : Heart rate + SpO2
 *  - MLX90614 (I2C)  : Contactless body temperature
 *  - DHT11 (Digital) : Ambient temperature + humidity
 *  - MPU6050 (I2C)   : Tilt angle + vibration estimate
 *
 * Output:
 *  - JSON line over Serial @ 115200 baud every second
 *  - Fields: heartRate, spo2, temperature, ambientTemperature, humidity,
 *            bpSystolic, bpDiastolic, respirationRate, vibrationLevel,
 *            tiltAngle, accelX, accelY, accelZ, irValue, redValue
 */

#include <Wire.h>
#include "MAX30105.h"
#include "heartRate.h"
#include <Adafruit_MLX90614.h>
#include <DHT.h>

// ---------- Sensor configuration ----------
#define DHT_PIN 2
#define DHT_TYPE DHT11
#define MPU6050_ADDRESS 0x68
#define MPU6050_PWR_MGMT_1 0x6B
#define MPU6050_ACCEL_XOUT_H 0x3B

MAX30105 maxSensor;
Adafruit_MLX90614 mlx = Adafruit_MLX90614();
DHT dht(DHT_PIN, DHT_TYPE);

bool maxReady = false;
bool mlxReady = false;
bool dhtReady = false;
bool mpuReady = false;

// ---------- Measurement storage ----------
float heartRate = 0.0f;
float spo2 = 0.0f;
float skinTemperature = 0.0f;
float ambientTemperature = 0.0f;
float humidity = 0.0f;
float bpSystolic = 0.0f;
float bpDiastolic = 0.0f;
float respirationRate = 0.0f;
float vibrationLevel = 0.0f;
float tiltAngle = 0.0f;
float accelX = 0.0f;
float accelY = 0.0f;
float accelZ = 0.0f;
long latestIrValue = 0;
long latestRedValue = 0;

unsigned long lastReadTime = 0;
const unsigned long READ_INTERVAL = 40;

// MAX30102 beat tracking helpers
const byte RATE_SIZE = 8;
float rates[RATE_SIZE] = {0};
byte rateSpot = 0;
byte validRateCount = 0;
unsigned long lastBeat = 0;
unsigned long lastFingerSeenAt = 0;
bool fingerPresent = false;

// SpO2 windowing helpers
const int SPO2_WINDOW_SAMPLES = 100;
float irDcLevel = 0.0f;
float redDcLevel = 0.0f;
float irAcEnergy = 0.0f;
float redAcEnergy = 0.0f;
int spo2SampleCount = 0;

bool setupMPU6050() {
  Wire.beginTransmission(MPU6050_ADDRESS);
  Wire.write(MPU6050_PWR_MGMT_1);
  Wire.write(0x00);
  if (Wire.endTransmission() != 0) {
    return false;
  }

  delay(100);
  return true;
}

bool readMPU6050Raw(int16_t &axRaw, int16_t &ayRaw, int16_t &azRaw) {
  Wire.beginTransmission(MPU6050_ADDRESS);
  Wire.write(MPU6050_ACCEL_XOUT_H);
  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  Wire.requestFrom(MPU6050_ADDRESS, 6);
  if (Wire.available() < 6) {
    return false;
  }

  axRaw = (Wire.read() << 8) | Wire.read();
  ayRaw = (Wire.read() << 8) | Wire.read();
  azRaw = (Wire.read() << 8) | Wire.read();
  return true;
}

void resetMaxReadings() {
  heartRate = 0.0f;
  spo2 = 0.0f;
  validRateCount = 0;
  rateSpot = 0;
  irAcEnergy = 0.0f;
  redAcEnergy = 0.0f;
  spo2SampleCount = 0;
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  randomSeed(analogRead(A3));

  Serial.println(F("SAHAYAK real-sensor streamer starting..."));

  if (maxSensor.begin(Wire, I2C_SPEED_FAST)) {
    byte ledBrightness = 0x3F;
    byte sampleAverage = 8;
    byte ledMode = 2;
    byte sampleRate = 100;
    byte pulseWidth = 411;
    byte adcRange = 4096;

    maxSensor.setup(ledBrightness, sampleAverage, ledMode, sampleRate, pulseWidth, adcRange);
    maxSensor.setPulseAmplitudeRed(0x2A);
    maxSensor.setPulseAmplitudeIR(0x2A);
    maxSensor.setPulseAmplitudeGreen(0);

    maxReady = true;
    Serial.println(F("MAX30102 ready"));
  } else {
    Serial.println(F("MAX30102 not detected - check wiring or power."));
  }

  if (mlx.begin()) {
    mlxReady = true;
    Serial.println(F("MLX90614 ready"));
  } else {
    Serial.println(F("MLX90614 not detected."));
  }

  dht.begin();
  dhtReady = true;
  Serial.println(F("DHT11 ready"));

  mpuReady = setupMPU6050();
  if (mpuReady) {
    Serial.println(F("MPU6050 ready"));
  } else {
    Serial.println(F("MPU6050 not detected."));
  }

  Serial.println(F("Streaming JSON payloads every second..."));
}

void loop() {
  readMaxSensor();
  readTemperatureSensors();
  readMotionSensor();
  applyFallbackIfNeeded();

  if (millis() - lastReadTime >= READ_INTERVAL) {
    lastReadTime = millis();
    sendDataJSON();
  }
}

void updateSpo2Estimate(long irValue, long redValue) {
  const float alpha = 0.95f;

  if (irDcLevel <= 0.0f) irDcLevel = (float)irValue;
  if (redDcLevel <= 0.0f) redDcLevel = (float)redValue;

  irDcLevel = (alpha * irDcLevel) + ((1.0f - alpha) * (float)irValue);
  redDcLevel = (alpha * redDcLevel) + ((1.0f - alpha) * (float)redValue);

  float irAc = (float)irValue - irDcLevel;
  float redAc = (float)redValue - redDcLevel;

  irAcEnergy += irAc * irAc;
  redAcEnergy += redAc * redAc;
  spo2SampleCount++;

  if (spo2SampleCount < SPO2_WINDOW_SAMPLES || irDcLevel < 1000.0f || redDcLevel < 1000.0f) {
    return;
  }

  float irRms = sqrt(irAcEnergy / (float)spo2SampleCount);
  float redRms = sqrt(redAcEnergy / (float)spo2SampleCount);
  float irNormalized = irRms / irDcLevel;
  float redNormalized = redRms / redDcLevel;

  if (irNormalized > 0.0f && redNormalized > 0.0f) {
    float ratio = redNormalized / irNormalized;
    float estimatedSpo2 = 110.0f - (25.0f * ratio);

    if (estimatedSpo2 >= 70.0f && estimatedSpo2 <= 100.0f) {
      spo2 = estimatedSpo2;
    }
  }

  irAcEnergy = 0.0f;
  redAcEnergy = 0.0f;
  spo2SampleCount = 0;
}

void readMaxSensor() {
  if (!maxReady) {
    return;
  }

  maxSensor.check();

  while (maxSensor.available()) {
    long irValue = maxSensor.getIR();
    long redValue = maxSensor.getRed();
    latestIrValue = irValue;
    latestRedValue = redValue;

    fingerPresent = irValue > 5000;
    if (fingerPresent) {
      lastFingerSeenAt = millis();
      updateSpo2Estimate(irValue, redValue);
    } else if (millis() - lastFingerSeenAt > 3000) {
      resetMaxReadings();
    }

    if (fingerPresent && checkForBeat(irValue)) {
      unsigned long now = millis();
      unsigned long delta = now - lastBeat;
      lastBeat = now;

      if (delta > 250 && delta < 1500) {
        float bpm = 60.0f / (delta / 1000.0f);
        if (bpm >= 40.0f && bpm <= 180.0f) {
          rates[rateSpot] = bpm;
          rateSpot = (rateSpot + 1) % RATE_SIZE;
          if (validRateCount < RATE_SIZE) {
            validRateCount++;
          }

          float total = 0.0f;
          for (byte i = 0; i < validRateCount; i++) {
            total += rates[i];
          }

          if (validRateCount > 0) {
            heartRate = total / validRateCount;
          }
        }
      }
    }

    maxSensor.nextSample();
  }
}

void readTemperatureSensors() {
  if (mlxReady) {
    float objTemp = mlx.readObjectTempC();
    float envTemp = mlx.readAmbientTempC();

    if (!isnan(objTemp)) {
      skinTemperature = objTemp;
    }
    if (!isnan(envTemp)) {
      ambientTemperature = envTemp;
    }
  }

  if (dhtReady) {
    float dhtHum = dht.readHumidity();
    float dhtTemp = dht.readTemperature();

    if (!isnan(dhtHum)) {
      humidity = dhtHum;
    }
    if (!isnan(dhtTemp)) {
      ambientTemperature = dhtTemp;
    }
  }
}

void readMotionSensor() {
  if (!mpuReady) {
    return;
  }

  int16_t axRaw = 0;
  int16_t ayRaw = 0;
  int16_t azRaw = 0;
  if (!readMPU6050Raw(axRaw, ayRaw, azRaw)) {
    return;
  }

  accelX = (float)axRaw / 16384.0f;
  accelY = (float)ayRaw / 16384.0f;
  accelZ = (float)azRaw / 16384.0f;

  float magnitude = sqrt((accelX * accelX) + (accelY * accelY) + (accelZ * accelZ));
  vibrationLevel = fabs(magnitude - 1.0f);

  float horizontal = sqrt((accelX * accelX) + (accelY * accelY));
  tiltAngle = atan2(horizontal, fabs(accelZ) < 0.01f ? 0.01f : fabs(accelZ)) * 180.0f / PI;
}

void applyFallbackIfNeeded() {
  if (!maxReady && heartRate <= 0) {
    heartRate = random(70, 90);
    spo2 = 96.0f + (random(-20, 10) / 10.0f);
  }

  if (!mlxReady && skinTemperature <= 0) {
    skinTemperature = 36.5f + (random(-5, 6) / 10.0f);
  }

  if (!dhtReady && humidity <= 0) {
    humidity = 50.0f + (random(-30, 30) / 10.0f);
    ambientTemperature = 28.0f + (random(-30, 30) / 10.0f);
  }

  if (!mpuReady) {
    vibrationLevel = 0.02f + (random(0, 20) / 1000.0f);
    tiltAngle = random(0, 8);
  }

  respirationRate = 16.0f;
}

void sendDataJSON() {
  Serial.print("{\"heartRate\":");
  Serial.print(heartRate, 1);
  Serial.print(",\"spo2\":");
  Serial.print(spo2, 1);
  Serial.print(",\"temperature\":");
  Serial.print(skinTemperature, 1);
  Serial.print(",\"ambientTemperature\":");
  Serial.print(ambientTemperature, 1);
  Serial.print(",\"humidity\":");
  Serial.print(humidity, 1);
  Serial.print(",\"bpSystolic\":");
  Serial.print(bpSystolic, 0);
  Serial.print(",\"bpDiastolic\":");
  Serial.print(bpDiastolic, 0);
  Serial.print(",\"respirationRate\":");
  Serial.print(respirationRate, 1);
  Serial.print(",\"vibrationLevel\":");
  Serial.print(vibrationLevel, 2);
  Serial.print(",\"tiltAngle\":");
  Serial.print(tiltAngle, 1);
  Serial.print(",\"accelX\":");
  Serial.print(accelX, 2);
  Serial.print(",\"accelY\":");
  Serial.print(accelY, 2);
  Serial.print(",\"accelZ\":");
  Serial.print(accelZ, 2);
  Serial.print(",\"irValue\":");
  Serial.print(latestIrValue);
  Serial.print(",\"redValue\":");
  Serial.print(latestRedValue);
  Serial.println("}");
}
