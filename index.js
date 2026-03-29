import express from 'express'
import { createServer } from 'http'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { WebSocketServer, WebSocket } from 'ws'
import { createBaseApp } from './createBaseApp.js'
import { arduinoService } from './arduinoService.js'

const app = createBaseApp({ arduinoRoutes: true, arduinoService })
const server = createServer(app)
const PORT = process.env.PORT || 5000

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const frontendDistPath = path.resolve(__dirname, '../frontend/dist')
const hasFrontendBuild = fs.existsSync(frontendDistPath)

if (hasFrontendBuild) {
  app.use(express.static(frontendDistPath))

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      return next()
    }

    return res.sendFile(path.join(frontendDistPath, 'index.html'))
  })
}

const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws) => {
  const currentData = arduinoService.getCurrentData()
  if (arduinoService.hasAnySensorValue(currentData)) {
    ws.send(JSON.stringify({ type: 'data', data: currentData }))
  }

  const dataCallback = (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'data', data }))
    }
  }

  arduinoService.onData(dataCallback)

  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message.toString())
      if (parsed.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }))
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error)
    }
  })

  ws.on('close', () => {
    arduinoService.removeCallback(dataCallback)
  })

  ws.on('error', () => {
    arduinoService.removeCallback(dataCallback)
  })
})

const autoConnectArduino = async () => {
  try {
    const ports = await arduinoService.listPorts()
    if (!ports.length) {
      console.log('No Arduino ports detected. Manual connection is available from Device Management.')
      return
    }

    const commonPorts = ['COM7', 'COM3', 'COM4', 'COM5', 'COM6', 'COM8', 'COM9', 'COM10']
    for (const portName of commonPorts) {
      const portExists = ports.find((port) => port.path === portName)
      if (!portExists) continue

      try {
        await arduinoService.connect(portName, 9600)
        console.log(`Auto-connected to Arduino on ${portName}`)
        return
      } catch {
        // keep trying
      }
    }

    try {
      await arduinoService.connect(ports[0].path, 9600)
      console.log(`Auto-connected to Arduino on ${ports[0].path}`)
    } catch (error) {
      console.log(`Could not auto-connect to Arduino: ${error.message}`)
    }
  } catch (error) {
    console.log(`Error during Arduino auto-connect: ${error.message}`)
  }
}

server.listen(PORT, () => {
  console.log(`SAHAYAK backend running on http://localhost:${PORT}`)
  console.log(`API health: http://localhost:${PORT}/api/health`)
  console.log(`WebSocket: ws://localhost:${PORT}/ws`)
  if (hasFrontendBuild) {
    console.log(`Frontend build detected at http://localhost:${PORT}`)
  }
  setTimeout(autoConnectArduino, 1000)
})
