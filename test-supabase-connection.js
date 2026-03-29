// Quick test script to verify Supabase connection
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

console.log('\n🔍 Testing Supabase Connection...\n')

// Check if credentials are set
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Error: SUPABASE_URL or SUPABASE_SERVICE_KEY not found in .env file')
  console.log('\n📝 Please update server/.env file with your Supabase credentials')
  process.exit(1)
}

// Check if still using placeholder values
if (supabaseUrl === 'your_supabase_project_url' || 
    supabaseServiceKey === 'your_supabase_service_key') {
  console.error('❌ Error: Still using placeholder values')
  console.log('\n📝 Please replace placeholder values in server/.env with your actual Supabase credentials')
  process.exit(1)
}

// Validate URL format
if (!supabaseUrl.startsWith('https://')) {
  console.error('❌ Error: SUPABASE_URL must start with https://')
  process.exit(1)
}

try {
  // Try to create client
  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  console.log('✅ Supabase client created successfully')
  console.log(`   URL: ${supabaseUrl}`)
  
  // Test connection by querying a table
  console.log('\n🔍 Testing database connection...')
  const { data, error } = await supabase
    .from('users')
    .select('count')
    .limit(1)
  
  if (error) {
    // If table doesn't exist, that's okay - schema might not be run yet
    if (error.code === 'PGRST116' || error.message.includes('does not exist')) {
      console.log('⚠️  Warning: Database tables not found')
      console.log('   Please run supabase-schema.sql in Supabase SQL Editor')
    } else {
      console.error('❌ Error connecting to database:', error.message)
      process.exit(1)
    }
  } else {
    console.log('✅ Database connection successful!')
    console.log('   Tables are accessible')
  }
  
  console.log('\n🎉 Supabase is properly configured!')
  console.log('   Your backend is ready to use the real database.\n')
  
} catch (error) {
  console.error('❌ Error:', error.message)
  console.log('\n📝 Please check your credentials in server/.env file')
  process.exit(1)
}




