import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import axios from 'axios'

dotenv.config()

const DEFAULT_AI_MODEL = process.env.DEFAULT_AI_MODEL || 'gpt-5-mini'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY
const isSupabaseConfigured =
  supabaseUrl &&
  supabaseServiceKey &&
  supabaseUrl !== 'your_supabase_project_url' &&
  supabaseServiceKey !== 'your_supabase_service_key' &&
  supabaseUrl.startsWith('http')

let supabase = null
if (isSupabaseConfigured) {
  try {
    supabase = createClient(supabaseUrl, supabaseServiceKey)
  } catch (error) {
    console.warn('Supabase initialization failed:', error.message)
  }
}

let openai = null
if (process.env.OPENAI_API_KEY) {
  try {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  } catch (error) {
    console.warn('OpenAI initialization failed:', error.message)
  }
}

const ensureSupabase = (res) => {
  if (supabase) return true
  res.status(503).json({ success: false, error: 'Database not configured' })
  return false
}

const buildVoiceFallback = (message = '') => {
  const lowerMessage = String(message || '').toLowerCase()

  if (lowerMessage.includes('safety')) {
    return 'Wear your helmet, gloves, shoes, and reflective gear, and report hazards immediately.'
  }

  if (lowerMessage.includes('emergency')) {
    return 'In an emergency, call 108, alert nearby people, and move to a safe area if possible.'
  }

  if (lowerMessage.includes('weather')) {
    return 'Check heat, rain, and wind before work, and take extra water and rest breaks in hot weather.'
  }

  return 'Ask about safety, health, emergency help, weather, work guidance, or sensor usage.'
}

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'No token provided' })
    }

    if (!supabase) {
      return res.status(503).json({ success: false, error: 'Database not configured' })
    }

    const token = authHeader.split(' ')[1]
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token)

    if (error || !user) {
      return res.status(401).json({ success: false, error: 'Invalid token' })
    }

    req.user = user
    next()
  } catch (error) {
    res.status(401).json({ success: false, error: 'Token verification failed' })
  }
}

const generateWorkerDataset = () => {
  const workers = []
  const random = (min, max) => Math.random() * (max - min) + min

  for (let i = 1; i <= 100; i += 1) {
    workers.push({
      worker_id: i,
      oxygen_level: Number(random(90.8, 99.7).toFixed(1)),
      heart_rate: Math.round(random(62, 109)),
      temperature: Number(random(35.7, 38.54).toFixed(2)),
      bp_systolic: Math.round(random(94, 146)),
      bp_diastolic: Math.round(random(61, 104)),
      respiration_rate: Number(random(13.1, 22.5).toFixed(1)),
    })
  }

  return workers
}

export const createBaseApp = ({ arduinoRoutes = false, arduinoService = null } = {}) => {
  const app = express()

  app.use(cors())
  app.use(express.json())

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      message: 'SAHAYAK API is running',
      supabase: Boolean(supabase),
      mode: arduinoRoutes ? 'local' : 'serverless',
    })
  })

  app.post('/api/auth/signup', async (req, res) => {
    try {
      if (!ensureSupabase(res)) return

      const { email, password, name, phone, language } = req.body
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, phone, language: language || 'en' },
      })

      if (authError) {
        return res.status(400).json({ success: false, error: authError.message })
      }

      const { data: profileData } = await supabase
        .from('users')
        .insert({
          id: authData.user.id,
          name,
          phone,
          language: language || 'en',
        })
        .select()
        .single()

      res.json({
        success: true,
        data: {
          user: authData.user,
          profile: profileData || null,
        },
      })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  })

  app.post('/api/auth/signin', async (req, res) => {
    try {
      if (!ensureSupabase(res)) return

      const { email, password } = req.body
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        return res.status(401).json({ success: false, error: error.message })
      }

      const { data: profile } = await supabase.from('users').select('*').eq('id', data.user.id).single()

      res.json({
        success: true,
        data: {
          user: data.user,
          session: data.session,
          profile: profile || null,
        },
      })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  })

  app.get('/api/auth/user', verifyToken, async (req, res) => {
    try {
      if (!ensureSupabase(res)) return

      const { data: profile } = await supabase.from('users').select('*').eq('id', req.user.id).single()
      res.json({ success: true, data: { user: req.user, profile: profile || null } })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  })

  app.post('/api/auth/signout', verifyToken, async (_req, res) => {
    res.json({ success: true, error: null })
  })

  app.put('/api/auth/profile', verifyToken, async (req, res) => {
    try {
      if (!ensureSupabase(res)) return

      const { name, phone, language } = req.body
      const { data, error } = await supabase
        .from('users')
        .upsert(
          {
            id: req.user.id,
            name,
            phone,
            language: language || 'en',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' }
        )
        .select()
        .single()

      if (error) throw error
      res.json({ success: true, data })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  })

  app.post('/api/health/record', verifyToken, async (req, res) => {
    try {
      if (!ensureSupabase(res)) return

      const { heartRate, spo2, temperature, deviceId } = req.body
      const { data, error } = await supabase
        .from('health_records')
        .insert({
          user_id: req.user.id,
          heart_rate: heartRate,
          spo2,
          temperature,
          device_id: deviceId,
          synced: true,
        })
        .select()
        .single()

      if (error) throw error
      res.json({ success: true, data })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  })

  app.get('/api/health/records', verifyToken, async (req, res) => {
    try {
      if (!ensureSupabase(res)) return

      const { startDate, endDate } = req.query
      let query = supabase
        .from('health_records')
        .select('*')
        .eq('user_id', req.user.id)
        .order('timestamp', { ascending: false })

      if (startDate) query = query.gte('timestamp', startDate)
      if (endDate) query = query.lte('timestamp', endDate)

      const { data, error } = await query.limit(100)
      if (error) throw error
      res.json({ success: true, data })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  })

  app.post('/api/ai/recommendations', async (req, res) => {
    try {
      const { vitalSigns } = req.body

      if (!openai) {
        return res.json({
          success: true,
          data: {
            recommendations: ['AI recommendations unavailable. Please consult a healthcare professional.'],
            riskLevel: 'unknown',
          },
        })
      }

      const prompt = `Analyze these vital signs and provide health recommendations:
Heart Rate: ${vitalSigns.heartRate} bpm
SpO2: ${vitalSigns.spo2}%
Temperature: ${vitalSigns.temperature}C

Format as JSON with keys riskLevel and recommendations.`

      const response = await openai.responses.create({
        model: DEFAULT_AI_MODEL,
        input: prompt,
      })

      const parsed = JSON.parse(response.output[0].content[0].text)
      res.json({ success: true, data: parsed })
    } catch (error) {
      res.json({
        success: true,
        data: {
          recommendations: ['Unable to generate recommendations. Please try again later.'],
          riskLevel: 'unknown',
        },
      })
    }
  })

  app.post('/api/ai/voice-assistant', async (req, res) => {
    try {
      const { message, language = 'en' } = req.body

      if (!openai) {
        return res.json({
          success: true,
          data: { response: buildVoiceFallback(message) },
        })
      }

      const response = await openai.responses.create({
        model: DEFAULT_AI_MODEL,
        input: [
          {
            role: 'system',
            content: `You are SAHAYAK, a helpful worker safety assistant. Reply concisely in ${language} when possible.`,
          },
          { role: 'user', content: message },
        ],
      })

      const text =
        response.output_text ||
        response.output?.[0]?.content?.[0]?.text ||
        'I ran into an issue while preparing a reply. Please try again.'

      res.json({ success: true, data: { response: text } })
    } catch (error) {
      res.json({
        success: true,
        data: { response: buildVoiceFallback(req.body?.message || '') },
      })
    }
  })

  app.post('/api/ai/job-match', async (req, res) => {
    try {
      const { userSkills, jobDescription } = req.body

      if (!openai) {
        return res.json({
          success: true,
          data: { matchScore: 0, missingSkills: [], strengths: [] },
        })
      }

      const response = await openai.responses.create({
        model: DEFAULT_AI_MODEL,
        input: `Analyze how well these skills match the job requirements:
User Skills: ${userSkills.join(', ')}
Job Description: ${jobDescription}

Format as JSON with keys matchScore, missingSkills, strengths.`,
      })

      const parsed = JSON.parse(response.output[0].content[0].text)
      res.json({ success: true, data: parsed })
    } catch (error) {
      res.json({
        success: true,
        data: { matchScore: 0, missingSkills: [], strengths: [] },
      })
    }
  })

  app.get('/api/weather', async (req, res) => {
    try {
      const { lat, lon } = req.query
      if (!lat || !lon) {
        return res.status(400).json({ success: false, error: 'Latitude and longitude required' })
      }

      const apiKey = process.env.OPENWEATHER_API_KEY
      if (!apiKey) {
        return res.status(500).json({ success: false, error: 'Weather API key not configured' })
      }

      const response = await axios.get(
        `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`
      )

      res.json({ success: true, data: response.data })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  })

  app.get('/api/weather/forecast', async (req, res) => {
    try {
      const { lat, lon } = req.query
      if (!lat || !lon) {
        return res.status(400).json({ success: false, error: 'Latitude and longitude required' })
      }

      const apiKey = process.env.OPENWEATHER_API_KEY
      if (!apiKey) {
        return res.status(500).json({ success: false, error: 'Weather API key not configured' })
      }

      const response = await axios.get(
        `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`
      )

      res.json({ success: true, data: response.data })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  })

  app.get('/api/notifications', verifyToken, async (req, res) => {
    try {
      if (!ensureSupabase(res)) return

      const { limit = 50 } = req.query
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', req.user.id)
        .order('timestamp', { ascending: false })
        .limit(Number(limit))

      if (error) throw error
      res.json({ success: true, data })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  })

  app.post('/api/notifications', verifyToken, async (req, res) => {
    try {
      if (!ensureSupabase(res)) return

      const { type, title, message } = req.body
      const { data, error } = await supabase
        .from('notifications')
        .insert({
          user_id: req.user.id,
          type,
          title,
          message,
          read: false,
        })
        .select()
        .single()

      if (error) throw error
      res.json({ success: true, data })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  })

  app.patch('/api/notifications/:id/read', verifyToken, async (req, res) => {
    try {
      if (!ensureSupabase(res)) return

      const { data, error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .select()
        .single()

      if (error) throw error
      res.json({ success: true, data })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  })

  app.get('/api/emergency-contacts', verifyToken, async (req, res) => {
    try {
      if (!ensureSupabase(res)) return

      const { data, error } = await supabase
        .from('emergency_contacts')
        .select('*')
        .eq('user_id', req.user.id)
        .order('is_primary', { ascending: false })

      if (error) throw error
      res.json({ success: true, data })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  })

  app.post('/api/emergency-contacts', verifyToken, async (req, res) => {
    try {
      if (!ensureSupabase(res)) return

      const { name, phone, relationship, isPrimary } = req.body
      const { data, error } = await supabase
        .from('emergency_contacts')
        .insert({
          user_id: req.user.id,
          name,
          phone,
          relationship,
          is_primary: isPrimary || false,
        })
        .select()
        .single()

      if (error) throw error
      res.json({ success: true, data })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  })

  app.delete('/api/emergency-contacts/:id', verifyToken, async (req, res) => {
    try {
      if (!ensureSupabase(res)) return

      const { error } = await supabase
        .from('emergency_contacts')
        .delete()
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)

      if (error) throw error
      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  })

  app.get('/api/schemes', async (req, res) => {
    try {
      if (!ensureSupabase(res)) return

      const { category, search } = req.query
      let query = supabase.from('government_schemes').select('*').eq('active', true)
      if (category && category !== 'all') query = query.eq('category', category)
      if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`)

      const { data, error } = await query.order('created_at', { ascending: false })
      if (error) throw error
      res.json({ success: true, data })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  })

  app.get('/api/jobs', async (req, res) => {
    try {
      if (!ensureSupabase(res)) return

      const { type, search } = req.query
      let query = supabase.from('jobs').select('*').eq('active', true)
      if (type && type !== 'all') query = query.eq('type', type)
      if (search) {
        query = query.or(`title.ilike.%${search}%,company.ilike.%${search}%,description.ilike.%${search}%`)
      }

      const { data, error } = await query.order('created_at', { ascending: false })
      if (error) throw error
      res.json({ success: true, data })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  })

  app.get('/api/education', async (req, res) => {
    try {
      if (!ensureSupabase(res)) return

      const { category, language } = req.query
      let query = supabase.from('education_content').select('*')
      if (category) query = query.eq('category', category)
      if (language) query = query.eq('language', language)

      const { data, error } = await query.order('created_at', { ascending: false })
      if (error) throw error
      res.json({ success: true, data })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  })

  app.get('/api/device', verifyToken, async (req, res) => {
    try {
      if (!ensureSupabase(res)) return

      const { data, error } = await supabase
        .from('device_data')
        .select('*')
        .eq('user_id', req.user.id)
        .order('last_sync', { ascending: false })
        .limit(1)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      res.json({ success: true, data: data || null })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  })

  app.post('/api/device', verifyToken, async (req, res) => {
    try {
      if (!ensureSupabase(res)) return

      const { deviceId, deviceName, batteryLevel, firmwareVersion } = req.body
      const { data, error } = await supabase
        .from('device_data')
        .upsert(
          {
            user_id: req.user.id,
            device_id: deviceId,
            device_name: deviceName,
            battery_level: batteryLevel,
            firmware_version: firmwareVersion,
            last_sync: new Date().toISOString(),
          },
          { onConflict: 'user_id,device_id' }
        )
        .select()
        .single()

      if (error) throw error
      res.json({ success: true, data })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  })

  if (arduinoRoutes && arduinoService) {
    app.get('/api/arduino/ports', async (_req, res) => {
      try {
        const ports = await arduinoService.listPorts()
        res.json({ success: true, data: ports })
      } catch (error) {
        res.status(500).json({ success: false, error: error.message })
      }
    })

    app.post('/api/arduino/connect', async (req, res) => {
      try {
        const { comPort = 'COM7', baudRate = 115200 } = req.body
        const result = await arduinoService.connect(comPort, baudRate)
        res.json({ success: true, ...result })
      } catch (error) {
        res.status(500).json({ success: false, error: error.message })
      }
    })

    app.post('/api/arduino/disconnect', async (_req, res) => {
      try {
        await arduinoService.disconnect()
        res.json({ success: true, message: 'Disconnected from Arduino' })
      } catch (error) {
        res.status(500).json({ success: false, error: error.message })
      }
    })

    app.get('/api/arduino/status', (_req, res) => {
      try {
        const status = arduinoService.getStatus()
        res.json({ success: true, data: status })
      } catch (error) {
        res.status(500).json({ success: false, error: error.message })
      }
    })

    app.get('/api/arduino/data', (_req, res) => {
      try {
        const data = arduinoService.getCurrentData()
        res.json({ success: true, data })
      } catch (error) {
        res.status(500).json({ success: false, error: error.message })
      }
    })
  } else {
    const unsupported = (_req, res) => {
      res.status(501).json({
        success: false,
        error: 'Arduino serial features require the local backend and are not available on Vercel serverless.',
      })
    }

    app.get('/api/arduino/ports', unsupported)
    app.post('/api/arduino/connect', unsupported)
    app.post('/api/arduino/disconnect', unsupported)
    app.get('/api/arduino/status', unsupported)
    app.get('/api/arduino/data', unsupported)
  }

  app.get('/api/workers/dataset', (_req, res) => {
    res.json({ success: true, data: generateWorkerDataset() })
  })

  return app
}
