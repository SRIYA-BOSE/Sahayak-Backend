-- SAHAYAK Database Schema for Supabase

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  name TEXT,
  phone TEXT,
  language TEXT DEFAULT 'en',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Health Records
CREATE TABLE IF NOT EXISTS public.health_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  heart_rate INTEGER,
  spo2 INTEGER,
  temperature DECIMAL(4,2),
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  device_id TEXT,
  synced BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Emergency Contacts
CREATE TABLE IF NOT EXISTS public.emergency_contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  relationship TEXT,
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'health', 'weather', 'safety'
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Government Schemes
CREATE TABLE IF NOT EXISTS public.government_schemes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT, -- 'health', 'education', 'employment', 'housing', 'financial'
  eligibility TEXT,
  documents TEXT[], -- Array of required documents
  link TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Jobs
CREATE TABLE IF NOT EXISTS public.jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  salary_min INTEGER,
  salary_max INTEGER,
  type TEXT, -- 'full-time', 'part-time', 'contract'
  description TEXT,
  skills TEXT[],
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Education Content
CREATE TABLE IF NOT EXISTS public.education_content (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category TEXT NOT NULL, -- 'safety', 'health', 'rights', 'skills'
  title TEXT NOT NULL,
  description TEXT,
  duration INTEGER, -- in minutes
  audio_url TEXT,
  content_url TEXT,
  language TEXT DEFAULT 'en',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Device Data
CREATE TABLE IF NOT EXISTS public.device_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  device_id TEXT,
  device_name TEXT,
  battery_level INTEGER,
  firmware_version TEXT,
  last_sync TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_health_records_user_id ON public.health_records(user_id);
CREATE INDEX IF NOT EXISTS idx_health_records_timestamp ON public.health_records(timestamp);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications(read);
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user_id ON public.emergency_contacts(user_id);

-- Row Level Security (RLS) Policies
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_data ENABLE ROW LEVEL SECURITY;

-- Users can only see their own data
CREATE POLICY "Users can view own profile" ON public.users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING (auth.uid() = id);

-- Health records policies
CREATE POLICY "Users can view own health records" ON public.health_records
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own health records" ON public.health_records
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Emergency contacts policies
CREATE POLICY "Users can manage own emergency contacts" ON public.emergency_contacts
  FOR ALL USING (auth.uid() = user_id);

-- Notifications policies
CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id);

-- Device data policies
CREATE POLICY "Users can manage own device data" ON public.device_data
  FOR ALL USING (auth.uid() = user_id);

-- Public read access for schemes and jobs
ALTER TABLE public.government_schemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.education_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active schemes" ON public.government_schemes
  FOR SELECT USING (active = TRUE);

CREATE POLICY "Anyone can view active jobs" ON public.jobs
  FOR SELECT USING (active = TRUE);

CREATE POLICY "Anyone can view education content" ON public.education_content
  FOR SELECT USING (TRUE);

