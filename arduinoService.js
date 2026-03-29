import { SerialPort } from 'serialport'
import { ReadlineParser } from '@serialport/parser-readline'

// Note: @serialport/parser-readline is part of serialport package
// If you get import errors, try: npm install @serialport/parser-readline

class ArduinoService {
  constructor() {
    this.port = null
    this.parser = null
    this.isConnected = false
    this.currentData = {
      heartRate: 0,
      spo2: 0,
      irValue: 0,
      redValue: 0,
      ambientTemperature: 0,
      humidity: 0,
      noiseLevel: 0,
      airQualityPpm: 0,
      vibrationLevel: 0,
      tiltAngle: 0,
      accelX: 0,
      accelY: 0,
      accelZ: 0,
      rawLine: '',
      sourceFormat: '',
    }
    this.dataCallbacks = []
    this.irProcessingState = {
      samples: [],
      prevIr: 0,
      prevPrevIr: 0,
      smoothedIr: 0,
      lastBeatTime: 0,
      refractoryMs: 400,
      beatIntervals: [],
    }
  }

  hasAnySensorValue(payload = {}) {
    const keys = [
      'heartRate',
      'spo2',
      'irValue',
      'redValue',
      'ambientTemperature',
      'humidity',
      'noiseLevel',
      'airQualityPpm',
      'vibrationLevel',
      'tiltAngle',
      'accelX',
      'accelY',
      'accelZ',
    ]

    return keys.some((key) => Number.isFinite(Number(payload[key])) && Number(payload[key]) !== 0)
  }

  normalizeSensorPayload(rawData = {}) {
    const readNumber = (...candidates) => {
      for (const candidate of candidates) {
        if (candidate === null || candidate === undefined || candidate === '') continue
        let parsed = Number(candidate)
        if (!Number.isFinite(parsed) && typeof candidate === 'string') {
          const match = candidate.match(/-?\d+(?:\.\d+)?/)
          if (match) {
            parsed = Number(match[0])
          }
        }
        if (Number.isFinite(parsed)) return parsed
      }
      return undefined
    }

    const dht22 = rawData.dht22 || {}
    const max30102 = rawData.max30102 || {}
    const mq135 = rawData.mq135 || {}
    const max4466 = rawData.max4466 || {}
    const mpu6050 = rawData.mpu6050 || {}

    const normalized = {
      heartRate: readNumber(
        rawData.heartRate,
        rawData.hr,
        rawData.max30102HeartRate,
        rawData.max30102Hr,
        max30102.heartRate,
        max30102.hr
      ),
      spo2: readNumber(
        rawData.spo2,
        rawData.oxygen,
        rawData.max30102SpO2,
        rawData.max30102Spo2,
        max30102.spo2,
        max30102.oxygen
      ),
      irValue: readNumber(
        rawData.irValue,
        rawData.ir,
        rawData.max30102Ir,
        max30102.irValue,
        max30102.ir
      ),
      redValue: readNumber(
        rawData.redValue,
        rawData.red,
        rawData.max30102Red,
        max30102.redValue,
        max30102.red
      ),
      ambientTemperature: readNumber(
        rawData.ambientTemperature,
        rawData.temperature,
        rawData.temp,
        rawData.dht22Temperature,
        rawData.dhtTemp,
        dht22.temperature,
        dht22.temp
      ),
      humidity: readNumber(
        rawData.humidity,
        rawData.dht22Humidity,
        rawData.rh,
        rawData.dhtRh,
        dht22.humidity,
        dht22.rh
      ),
      noiseLevel: readNumber(
        rawData.noiseLevel,
        rawData.noiseDb,
        rawData.soundDb,
        rawData.max4466Db,
        rawData.max4466Dba,
        max4466.noiseLevel,
        max4466.db,
        max4466.dba
      ),
      airQualityPpm: readNumber(
        rawData.airQualityPpm,
        rawData.airQuality,
        rawData.gasPpm,
        rawData.mq135Ppm,
        rawData.co2,
        mq135.ppm,
        mq135.airQualityPpm
      ),
      vibrationLevel: readNumber(
        rawData.vibrationLevel,
        rawData.vibration,
        rawData.accelMagnitude,
        rawData.mpu6050Vibration,
        mpu6050.vibrationLevel,
        mpu6050.vibration,
        mpu6050.accelMagnitude
      ),
      tiltAngle: readNumber(
        rawData.tiltAngle,
        rawData.tilt,
        rawData.mpu6050Tilt,
        rawData.mpu6050TiltAngle,
        mpu6050.tilt,
        mpu6050.tiltAngle
      ),
      accelX: readNumber(rawData.accelX, rawData.ax, rawData.x, mpu6050.accelX, mpu6050.ax),
      accelY: readNumber(rawData.accelY, rawData.ay, rawData.y, mpu6050.accelY, mpu6050.ay),
      accelZ: readNumber(rawData.accelZ, rawData.az, rawData.z, mpu6050.accelZ, mpu6050.az),
      rawLine: rawData.rawLine || '',
      sourceFormat: rawData.sourceFormat || '',
    }

    if (!normalized.vibrationLevel && (normalized.accelX || normalized.accelY || normalized.accelZ)) {
      const magnitude = Math.sqrt(
        normalized.accelX ** 2 + normalized.accelY ** 2 + normalized.accelZ ** 2
      )
      normalized.vibrationLevel = Number(magnitude.toFixed(2))
    }

    if (
      (!normalized.tiltAngle || normalized.tiltAngle === 0) &&
      (normalized.accelX || normalized.accelY || normalized.accelZ)
    ) {
      const horizontal = Math.sqrt(
        (normalized.accelX || 0) ** 2 + (normalized.accelY || 0) ** 2
      )
      const vertical = Math.abs(normalized.accelZ || 0) || 0.01
      normalized.tiltAngle = Number((Math.atan2(horizontal, vertical) * 180 / Math.PI).toFixed(1))
    }

    if (
      (!normalized.spo2 || normalized.spo2 === 0) &&
      Number.isFinite(normalized.irValue) &&
      Number.isFinite(normalized.redValue) &&
      normalized.irValue > 0 &&
      normalized.redValue > 0
    ) {
      const ratio = normalized.redValue / normalized.irValue
      const estimatedSpo2 = 110 - ratio * 25
      if (estimatedSpo2 >= 70 && estimatedSpo2 <= 100) {
        normalized.spo2 = Number(estimatedSpo2.toFixed(1))
      }
    }

    if (
      (!normalized.heartRate || normalized.heartRate === 0) &&
      Number.isFinite(normalized.irValue) &&
      normalized.irValue > 0
    ) {
      const derivedHeartRate = this.estimateHeartRateFromIr(normalized.irValue)
      if (derivedHeartRate) {
        normalized.heartRate = derivedHeartRate
      }
    }

    return normalized
  }

  estimateHeartRateFromIr(irValue) {
    if (!Number.isFinite(irValue) || irValue < 5000) {
      return 0
    }

    const now = Date.now()
    const state = this.irProcessingState
    state.samples.push(irValue)
    if (state.samples.length > 15) {
      state.samples.shift()
    }

    if (!state.smoothedIr) {
      state.smoothedIr = irValue
    }

    state.smoothedIr = (0.92 * state.smoothedIr) + (0.08 * irValue)
    const rollingMean =
      state.samples.reduce((sum, value) => sum + value, 0) / state.samples.length
    const dynamicThreshold = Math.max(20, rollingMean * 0.0015)
    const rising = state.prevIr > state.prevPrevIr
    const falling = irValue < state.prevIr
    const peakHeight = state.prevIr - rollingMean
    const beatDetected =
      rising &&
      falling &&
      peakHeight > dynamicThreshold &&
      state.prevIr > state.smoothedIr &&
      now - state.lastBeatTime > state.refractoryMs

    let derivedHeartRate = 0
    if (beatDetected) {
      if (state.lastBeatTime > 0) {
        const interval = now - state.lastBeatTime
        if (interval >= 300 && interval <= 1500) {
          state.beatIntervals.push(interval)
          if (state.beatIntervals.length > 6) {
            state.beatIntervals.shift()
          }

          const averageInterval =
            state.beatIntervals.reduce((sum, value) => sum + value, 0) /
            state.beatIntervals.length
          const bpm = 60000 / averageInterval
          if (bpm >= 40 && bpm <= 180) {
            derivedHeartRate = Number(bpm.toFixed(1))
          }
        }
      }

      state.lastBeatTime = now
    }

    state.prevPrevIr = state.prevIr
    state.prevIr = irValue
    return derivedHeartRate
  }

  // List available COM ports
  async listPorts() {
    try {
      const ports = await SerialPort.list()
      return ports.map(port => ({
        path: port.path,
        manufacturer: port.manufacturer,
        serialNumber: port.serialNumber,
        pnpId: port.pnpId,
      }))
    } catch (error) {
      console.error('Error listing ports:', error)
      return []
    }
  }

  // Connect to Arduino on specified COM port
  async connect(comPort = 'COM7', baudRate = 115200) {
    try {
      // Close existing connection if any
      if (this.port && this.isConnected) {
        await this.disconnect()
      }

      console.log(`Attempting to connect to ${comPort} at ${baudRate} baud...`)

      // Create serial port connection
      this.port = new SerialPort({
        path: comPort,
        baudRate: baudRate,
        autoOpen: false,
      })

      // Create parser for reading line-by-line
      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }))

      // Handle incoming data
      this.parser.on('data', (data) => {
        this.parseArduinoData(data.toString().trim())
      })

      // Handle errors
      this.port.on('error', (error) => {
        console.error('Serial port error:', error)
        this.isConnected = false
        this.notifyCallbacks({ error: error.message })
      })

      // Handle port close
      this.port.on('close', () => {
        console.log('Serial port closed')
        this.isConnected = false
        this.notifyCallbacks({ disconnected: true })
      })

      // Open the port
      return new Promise((resolve, reject) => {
        this.port.open((error) => {
          if (error) {
            console.error('Failed to open port:', error)
            this.isConnected = false
            reject(error)
          } else {
            console.log(`✅ Successfully connected to ${comPort}`)
            this.isConnected = true
            resolve({ success: true, message: `Connected to ${comPort}` })
          }
        })
      })
    } catch (error) {
      console.error('Connection error:', error)
      this.isConnected = false
      throw error
    }
  }

  // Parse Arduino data (expects JSON or comma-separated values)
  parseArduinoData(data) {
    try {
      const rawLine = data
      const findNumberAfterKeywords = (line, keywords = []) => {
        for (const keyword of keywords) {
          const regex = new RegExp(`${keyword}[^\\d\\-]*(-?\\d+(?:\\.\\d+)?)`, 'i')
          const match = line.match(regex)
          if (match && Number.isFinite(Number(match[1]))) {
            return Number(match[1])
          }
        }
        return undefined
      }

      // Try to parse as JSON first
      if (data.startsWith('{') || data.startsWith('[')) {
        const jsonData = JSON.parse(data)
        const normalizedData = this.normalizeSensorPayload({
          ...jsonData,
          rawLine,
          sourceFormat: 'json',
        })
        this.updateData(normalizedData)
        return
      }

      // Key-value logs from Serial Monitor:
      // e.g. "HR: 82, SpO2: 98, Temp: 30.4, Humidity: 56, MQ135: 410, Noise: 63"
      if (/[=:]/.test(data)) {
        const keyValueData = {}
        const pattern = /([a-zA-Z][a-zA-Z0-9 _\-\/()%]*)\s*[:=]\s*(-?\d+(?:\.\d+)?)/g
        let match

        while ((match = pattern.exec(data)) !== null) {
          const rawKey = match[1].toLowerCase().trim()
          const key = rawKey.replace(/[^a-z0-9]/g, '')
          const value = parseFloat(match[2])
          if (!Number.isFinite(value)) continue

          if (
            key === 'hr' ||
            key === 'heartrate' ||
            key === 'pulse' ||
            key === 'bpm' ||
            key.includes('heartrate')
          ) keyValueData.heartRate = value
          else if (
            key === 'ir' ||
            key === 'irvalue' ||
            key === 'infrared' ||
            key.includes('max30102ir')
          ) keyValueData.irValue = value
          else if (
            key === 'red' ||
            key === 'redvalue' ||
            key.includes('max30102red')
          ) keyValueData.redValue = value
          else if (
            key === 'spo2' ||
            key === 'spo' ||
            key === 'sp02' ||
            key === 'oxygen' ||
            key === 'oxygenlevel' ||
            key.includes('spo2') ||
            key.includes('oxygen')
          ) keyValueData.spo2 = value
          else if (
            key === 'temp' ||
            key === 'temperature' ||
            key === 'ambienttemperature' ||
            key === 'dht22temp' ||
            key === 'dhttemperature' ||
            key.includes('temperature')
          ) keyValueData.ambientTemperature = value
          else if (
            key === 'humidity' ||
            key === 'rh' ||
            key === 'relativehumidity' ||
            key === 'dht22humidity' ||
            key.includes('humidity')
          ) keyValueData.humidity = value
          else if (
            key === 'noise' ||
            key === 'noiselevel' ||
            key === 'max4466' ||
            key === 'db' ||
            key === 'dba' ||
            key === 'sound' ||
            key === 'sounddb' ||
            key.includes('noise') ||
            key.includes('sound')
          ) keyValueData.noiseLevel = value
          else if (
            key === 'airquality' ||
            key === 'airqualityppm' ||
            key === 'mq135' ||
            key === 'mq135ppm' ||
            key === 'gasppm' ||
            key === 'co2' ||
            key.includes('airquality') ||
            key.includes('mq135') ||
            key.includes('gas')
          ) keyValueData.airQualityPpm = value
          else if (
            key === 'vibration' ||
            key === 'vibrationlevel' ||
            key === 'accelmagnitude' ||
            key === 'mpu6050vibration' ||
            key.includes('vibration')
          ) keyValueData.vibrationLevel = value
          else if (
            key === 'tilt' ||
            key === 'tiltangle' ||
            key === 'mpu6050tilt' ||
            key.includes('tilt')
          ) keyValueData.tiltAngle = value
          else if (key === 'ax' || key === 'accelx' || key === 'x') keyValueData.accelX = value
          else if (key === 'ay' || key === 'accely' || key === 'y') keyValueData.accelY = value
          else if (key === 'az' || key === 'accelz' || key === 'z') keyValueData.accelZ = value
        }

        if (Object.keys(keyValueData).length > 0) {
          const parsedData = this.normalizeSensorPayload({
            ...keyValueData,
            rawLine,
            sourceFormat: 'kv',
          })
          this.updateData(parsedData)
          return
        }
      }

      // Free-form heuristic parser (supports labels with units in any order).
      // Example:
      // "Heart Rate 82 bpm | SpO2 97 % | Noise 64 dBA | MQ135 420 ppm | Tilt 12 deg"
      const heuristic = {
        heartRate: findNumberAfterKeywords(data, [
          'heart\\s*rate',
          '\\bhr\\b',
          'pulse',
          '\\bbpm\\b',
          'max30102',
        ]),
        irValue: findNumberAfterKeywords(data, [
          '\\bir\\b',
          'infrared',
          'ir\\s*value',
        ]),
        redValue: findNumberAfterKeywords(data, [
          '\\bred\\b',
          'red\\s*value',
        ]),
        spo2: findNumberAfterKeywords(data, [
          'spo2',
          'spo',
          'oxygen',
          'o2',
          'max30102',
        ]),
        ambientTemperature: findNumberAfterKeywords(data, [
          'ambient\\s*temp',
          'temperature',
          'temp',
          'dht22',
        ]),
        humidity: findNumberAfterKeywords(data, [
          'humidity',
          'relative\\s*humidity',
          '\\brh\\b',
          'dht22',
        ]),
        noiseLevel: findNumberAfterKeywords(data, [
          'noise\\s*level',
          '\\bnoise\\b',
          '\\bsound\\b',
          'max4466',
          '\\bdba\\b',
          '\\bdb\\b',
        ]),
        airQualityPpm: findNumberAfterKeywords(data, [
          'air\\s*quality',
          'mq135',
          'gas',
          'co2',
          'ppm',
        ]),
        vibrationLevel: findNumberAfterKeywords(data, [
          'vibration',
          'accel\\s*magnitude',
          'mpu6050',
        ]),
        tiltAngle: findNumberAfterKeywords(data, [
          'tilt\\s*angle',
          '\\btilt\\b',
          'mpu6050',
          'deg',
        ]),
        accelX: findNumberAfterKeywords(data, ['accel\\s*x', '\\bax\\b', 'x\\s*=']),
        accelY: findNumberAfterKeywords(data, ['accel\\s*y', '\\bay\\b', 'y\\s*=']),
        accelZ: findNumberAfterKeywords(data, ['accel\\s*z', '\\baz\\b', 'z\\s*=']),
      }

      if (Object.values(heuristic).some((value) => Number.isFinite(value))) {
        const parsedData = this.normalizeSensorPayload({
          ...heuristic,
          rawLine,
          sourceFormat: 'heuristic',
        })
        this.updateData(parsedData)
        return
      }

      // CSV order:
      // HR,SpO2,DHT22 Temp,DHT22 Humidity,MAX4466 dBA,MQ135 ppm,MPU6050 vibration,MPU6050 tilt[,ax,ay,az]
      const values = data.split(',').map(v => parseFloat(v.trim()))
      const valueOrUndefined = (index) => (Number.isFinite(values[index]) ? values[index] : undefined)
      const roundedOrUndefined = (index) =>
        Number.isFinite(values[index]) ? Math.round(values[index]) : undefined
      const fixedOrUndefined = (index, decimals) =>
        Number.isFinite(values[index]) ? parseFloat(values[index].toFixed(decimals)) : undefined

      const hasCoreCsv = Number.isFinite(values[0]) && Number.isFinite(values[1]) && Number.isFinite(values[2])
      if (values.length >= 3 && hasCoreCsv) {
        const parsedData = this.normalizeSensorPayload({
          heartRate: roundedOrUndefined(0),
          spo2: roundedOrUndefined(1),
          ambientTemperature: fixedOrUndefined(2, 1),
          humidity: fixedOrUndefined(3, 1),
          noiseLevel: fixedOrUndefined(4, 1),
          airQualityPpm: roundedOrUndefined(5),
          vibrationLevel: fixedOrUndefined(6, 2),
          tiltAngle: fixedOrUndefined(7, 1),
          accelX: fixedOrUndefined(8, 2),
          accelY: fixedOrUndefined(9, 2),
          accelZ: fixedOrUndefined(10, 2),
          rawLine,
          sourceFormat: 'csv',
        })
        this.updateData(parsedData)
        return
      }

      // Try space-separated format
      const spaceValues = data.split(/\s+/).map(v => parseFloat(v))
      const spaceRoundedOrUndefined = (index) =>
        Number.isFinite(spaceValues[index]) ? Math.round(spaceValues[index]) : undefined
      const spaceFixedOrUndefined = (index, decimals) =>
        Number.isFinite(spaceValues[index]) ? parseFloat(spaceValues[index].toFixed(decimals)) : undefined
      const hasCoreSpace = Number.isFinite(spaceValues[0]) && Number.isFinite(spaceValues[1]) && Number.isFinite(spaceValues[2])
      if (spaceValues.length >= 3 && hasCoreSpace) {
        const parsedData = this.normalizeSensorPayload({
          heartRate: spaceRoundedOrUndefined(0),
          spo2: spaceRoundedOrUndefined(1),
          ambientTemperature: spaceFixedOrUndefined(2, 1),
          humidity: spaceFixedOrUndefined(3, 1),
          noiseLevel: spaceFixedOrUndefined(4, 1),
          airQualityPpm: spaceRoundedOrUndefined(5),
          vibrationLevel: spaceFixedOrUndefined(6, 2),
          tiltAngle: spaceFixedOrUndefined(7, 1),
          rawLine,
          sourceFormat: 'space',
        })
        this.updateData(parsedData)
        return
      }

      console.log('Unrecognized data format:', data)
      this.notifyCallbacks({
        ...this.currentData,
        rawLine,
        sourceFormat: 'raw',
        timestamp: new Date().toISOString(),
      })
    } catch (error) {
      console.error('Error parsing Arduino data:', error, 'Raw data:', data)
    }
  }

  // Update current data and notify callbacks
  updateData(newData) {
    const merged = { ...this.currentData }
    const stickyPositiveKeys = new Set(['heartRate', 'spo2'])
    for (const [key, value] of Object.entries(newData)) {
      if (key === 'rawLine' || key === 'sourceFormat') {
        merged[key] = value
        continue
      }
      if (key === 'timestamp') continue
      if (typeof value === 'number' && Number.isFinite(value)) {
        if (stickyPositiveKeys.has(key) && value <= 0 && Number(merged[key]) > 0) {
          continue
        }
        merged[key] = value
      }
    }
    this.currentData = {
      ...merged,
      timestamp: new Date().toISOString(),
    }
    this.notifyCallbacks(this.currentData)
  }

  // Register callback for data updates
  onData(callback) {
    this.dataCallbacks.push(callback)
    // Immediately send current data if available
    if (this.hasAnySensorValue(this.currentData)) {
      callback(this.currentData)
    }
  }

  // Remove callback
  removeCallback(callback) {
    this.dataCallbacks = this.dataCallbacks.filter(cb => cb !== callback)
  }

  // Notify all registered callbacks
  notifyCallbacks(data) {
    this.dataCallbacks.forEach(callback => {
      try {
        callback(data)
      } catch (error) {
        console.error('Error in data callback:', error)
      }
    })
  }

  // Disconnect from Arduino
  async disconnect() {
    return new Promise((resolve) => {
      if (this.port && this.isConnected) {
        this.port.close((error) => {
          if (error) {
            console.error('Error closing port:', error)
          } else {
            console.log('Disconnected from Arduino')
          }
          this.isConnected = false
          this.port = null
          this.parser = null
          resolve()
        })
      } else {
        resolve()
      }
    })
  }

  // Get current connection status
  getStatus() {
    return {
      isConnected: this.isConnected,
      currentData: this.currentData,
    }
  }

  // Get current data
  getCurrentData() {
    return this.currentData
  }
}

// Export singleton instance
export const arduinoService = new ArduinoService()
