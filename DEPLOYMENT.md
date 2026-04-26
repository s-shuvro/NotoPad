# Deployment Guide for Noto Notepad

## Vercel Deployment Steps

1. **Connect Repository**: Upload your code to GitHub and connect it to Vercel.
2. **Framework Preset**: Vercel should automatically detect **Vite**.
3. **Environment Variables**: In the Vercel Project Settings, add the following variables:
   - `VITE_SUPABASE_URL`: Your Supabase Project URL (`https://vruwguckzmglkihmpzbs.supabase.co`)
   - `VITE_SUPABASE_ANON_KEY`: Your Supabase Anon API Key
4. **Build Settings**:
   - Build Command: `npm run build`
   - Output Directory: `dist`
5. **Supabase Auth Configuration**:
   - Once your app is deployed, you will get a Vercel URL (e.g., `https://noto-notepad.vercel.app`).
   - Copy this URL.
   - Go to **Supabase Dashboard** -> **Authentication** -> **URL Configuration**.
   - Set the **Site URL** to your Vercel URL so that confirmation emails and login redirects work correctly.

## Note on SQL Error
If you saw an error like `relation "notes" already exists`, ignore it! It simply means your database structure is already perfectly set up and ready to go.
