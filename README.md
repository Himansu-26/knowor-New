# Knowora – setup
1. Supabase: create project → SQL Editor → run supabase.sql. Authentication → Providers → Email → turn OFF "Confirm email" (easier testing).
2. Copy keys: Project Settings → API (URL, anon, service_role).
3. Google AI Studio → create Gemini API key.
4. Local test: npm install, copy .env.example to .env, fill it, run: node --env-file=.env server.js → open http://localhost:3000
5. GitHub: push this folder (never commit .env).
6. Render: New → Web Service → repo. Build: npm install. Start: npm start. Add the 5 env vars from .env.example.
7. Keep awake: free UptimeRobot monitor pinging https://YOUR-APP.onrender.com/health every 5 min.
