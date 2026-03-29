# 🔧 Server Environment Variables Setup

## Problem Fixed! ✅

The server code has been updated to handle missing Supabase credentials gracefully. The server will now start even without Supabase configured, but database features won't work until you add your credentials.

---

## 📝 Quick Setup

### Step 1: Create `.env` File

The `.env` file has been created in the `server` folder. You need to fill in your actual credentials.

### Step 2: Get Supabase Credentials

1. **Go to [Supabase Dashboard](https://supabase.com/dashboard)**
2. **Select your project** (or create a new one)
3. **Go to Project Settings** (gear icon in left sidebar)
4. **Click on "API"** in the settings menu
5. **Copy these values:**
   - **Project URL** → This is your `SUPABASE_URL`
   - **service_role key** (secret) → This is your `SUPABASE_SERVICE_KEY`

### Step 3: Update `.env` File

Open `server/.env` file and replace the placeholder values:

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Important:** 
- Use the **service_role** key (not the anon key) for the backend
- The service_role key has admin privileges and should be kept secret
- Never commit the `.env` file to git!

---

## 🔑 Optional API Keys

### OpenAI API Key (for AI features)

1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Sign in or create an account
3. Click "Create new secret key"
4. Copy the key and add to `.env`:
   ```env
   OPENAI_API_KEY=sk-proj-...
   ```

### OpenWeatherMap API Key (for weather features)

1. Go to [OpenWeatherMap](https://openweathermap.org/api)
2. Sign up for a free account
3. Get your API key from the dashboard
4. Add to `.env`:
   ```env
   OPENWEATHER_API_KEY=your_weather_api_key
   ```

---

## ✅ Verify Setup

After updating `.env`, restart your server:

```bash
cd server
npm start
```

You should see:
```
✅ Supabase client initialized
🚀 SAHAYAK Backend running on http://localhost:5000
```

If Supabase is not configured, you'll see:
```
⚠️  Supabase not configured. Some features may not work.
   Please set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env file
🚀 SAHAYAK Backend running on http://localhost:5000
```

The server will still run, but database features will return error messages.

---

## 🛠️ Troubleshooting

### Error: "Invalid supabaseUrl"
- Make sure `SUPABASE_URL` starts with `https://`
- Check that you copied the full URL from Supabase dashboard
- Remove any extra spaces or quotes

### Error: "Invalid API key"
- Make sure you're using the **service_role** key (not anon key)
- Check for extra spaces or line breaks in the key
- The key should start with `eyJ...`

### Server still shows warning
- Make sure `.env` file is in the `server` folder (not root folder)
- Restart the server after updating `.env`
- Check that variable names match exactly (case-sensitive)

### Database features not working
- Verify Supabase credentials are correct
- Check that your Supabase project is active
- Make sure you've run the database schema (see `supabase-schema.sql`)

---

## 📚 Additional Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase Dashboard](https://supabase.com/dashboard)
- [OpenAI API Documentation](https://platform.openai.com/docs)
- [OpenWeatherMap API Documentation](https://openweathermap.org/api)

---

## 🔒 Security Notes

1. **Never commit `.env` to git** - it contains sensitive keys
2. The `.env` file should be in `.gitignore`
3. Use different keys for development and production
4. The service_role key has admin access - keep it secret!

---

**Need help?** Check the main project documentation or Supabase support.




