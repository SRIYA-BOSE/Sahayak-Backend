// Helper script to update .env file with Supabase credentials
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const envPath = path.join(__dirname, '.env')

console.log('\n🔧 Updating .env file with Supabase credentials...\n')

// Get credentials from command line arguments
const supabaseUrl = process.argv[2]
const supabaseKey = process.argv[3]

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Missing credentials')
  console.log('\nUsage: node update-env.js <SUPABASE_URL> <SUPABASE_SERVICE_KEY>')
  process.exit(1)
}

// Validate URL
if (!supabaseUrl.startsWith('https://')) {
  console.error('❌ Error: SUPABASE_URL must start with https://')
  process.exit(1)
}

// Read existing .env file
let envContent = ''
try {
  envContent = fs.readFileSync(envPath, 'utf8')
} catch (error) {
  console.log('⚠️  .env file not found, creating new one...')
  envContent = `# Server Port
PORT=5000

# Supabase Configuration
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_KEY=your_supabase_service_key

# OpenAI Configuration (Optional)
OPENAI_API_KEY=your_openai_api_key

# OpenWeatherMap Configuration (Optional)
OPENWEATHER_API_KEY=your_openweathermap_api_key
`
}

// Update the values
envContent = envContent.replace(
  /SUPABASE_URL=.*/,
  `SUPABASE_URL=${supabaseUrl}`
)

envContent = envContent.replace(
  /SUPABASE_SERVICE_KEY=.*/,
  `SUPABASE_SERVICE_KEY=${supabaseKey}`
)

// Write back to file
try {
  fs.writeFileSync(envPath, envContent, 'utf8')
  console.log('✅ .env file updated successfully!')
  console.log(`   SUPABASE_URL: ${supabaseUrl}`)
  console.log(`   SUPABASE_SERVICE_KEY: ${supabaseKey.substring(0, 20)}...`)
  console.log('\n🎉 Done! Now run: npm run test-db\n')
} catch (error) {
  console.error('❌ Error writing .env file:', error.message)
  process.exit(1)
}




