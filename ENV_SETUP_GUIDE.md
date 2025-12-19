# Environment Variables Setup Guide

## Overview

This guide explains how to set up environment variables for the ForexOrbit Academy app, including the new broker API integration.

## Environment Variables Required

### Core Application Variables

```env
# Database
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/Forex_elearning?retryWrites=true&w=majority

# Authentication
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# Socket.IO
NEXT_PUBLIC_SOCKET_URL=https://forexorbit-academy.onrender.com
ALLOWED_ORIGINS=https://forexorbit-academy.vercel.app,https://forexorbit-academy.onrender.com

# Agora (for video calls)
NEXT_PUBLIC_AGORA_APP_ID=your-agora-app-id
AGORA_APP_CERTIFICATE=your-agora-app-certificate
```

### Broker API Integration Variables (NEW)

```env
# Broker Configuration
BROKER_TYPE=oanda
BROKER_DEMO_MODE=true  # CRITICAL: Must be true (only demo trading allowed)

# OANDA API Credentials
OANDA_API_KEY=your_oanda_practice_api_key
OANDA_ACCOUNT_ID=your_oanda_practice_account_id
OANDA_DEMO_URL=https://api-fxpractice.oanda.com
```

## Setup Instructions

### 1. Local Development (.env.local)

1. **Create `.env.local` file** in the root directory of your project:
   ```
   Inforex_app/
   ├── .env.local  ← Create this file
   ├── package.json
   └── ...
   ```

2. **Add all environment variables** to `.env.local`:
   ```env
   # Database
   MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/Forex_elearning?retryWrites=true&w=majority

   # Authentication
   JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

   # Socket.IO
   NEXT_PUBLIC_SOCKET_URL=http://localhost:3000
   ALLOWED_ORIGINS=http://localhost:3000

   # Agora
   NEXT_PUBLIC_AGORA_APP_ID=your-agora-app-id
   AGORA_APP_CERTIFICATE=your-agora-app-certificate

   # Broker API (OANDA Demo)
   BROKER_TYPE=oanda
   BROKER_DEMO_MODE=true
   OANDA_API_KEY=your_oanda_practice_api_key
   OANDA_ACCOUNT_ID=your_oanda_practice_account_id
   OANDA_DEMO_URL=https://api-fxpractice.oanda.com
   ```

3. **Important Notes:**
   - `.env.local` is already in `.gitignore` - it won't be committed to git
   - Never commit API keys or secrets to version control
   - Restart your development server after adding/changing variables

### 2. Vercel (Frontend Deployment)

1. **Go to Vercel Dashboard:**
   - Visit: https://vercel.com/dashboard
   - Select your project: `forexorbit-academy`

2. **Navigate to Settings:**
   - Click on your project
   - Go to **Settings** → **Environment Variables**

3. **Add Environment Variables:**
   Click **Add New** and add each variable:

   **Public Variables** (accessible in browser):
   ```
   NEXT_PUBLIC_SOCKET_URL = https://forexorbit-academy.onrender.com
   NEXT_PUBLIC_AGORA_APP_ID = your-agora-app-id
   ```

   **Private Variables** (server-side only):
   ```
   MONGO_URI = mongodb+srv://...
   JWT_SECRET = your-secret-key
   AGORA_APP_CERTIFICATE = your-certificate
   ALLOWED_ORIGINS = https://forexorbit-academy.vercel.app,https://forexorbit-academy.onrender.com
   
   # Broker API (server-side only)
   BROKER_TYPE = oanda
   BROKER_DEMO_MODE = true
   OANDA_API_KEY = your_oanda_practice_api_key
   OANDA_ACCOUNT_ID = your_oanda_practice_account_id
   OANDA_DEMO_URL = https://api-fxpractice.oanda.com
   ```

4. **Select Environments:**
   - For each variable, select which environments it applies to:
     - ✅ Production
     - ✅ Preview
     - ✅ Development (optional)

5. **Redeploy:**
   - After adding variables, go to **Deployments**
   - Click **Redeploy** on the latest deployment
   - Or push a new commit to trigger automatic deployment

### 3. Render (Backend/Socket.IO Server)

1. **Go to Render Dashboard:**
   - Visit: https://dashboard.render.com
   - Select your web service: `forex-elearning-app` (or your service name)

2. **Navigate to Environment:**
   - Click on your service
   - Go to **Environment** tab

3. **Add Environment Variables:**
   Click **Add Environment Variable** and add:

   ```
   NODE_ENV = production
   PORT = 3000
   
   # Database
   MONGO_URI = mongodb+srv://...
   
   # Authentication
   JWT_SECRET = your-secret-key
   
   # Socket.IO
   NEXT_PUBLIC_SOCKET_URL = https://forexorbit-academy.onrender.com
   ALLOWED_ORIGINS = https://forexorbit-academy.vercel.app,https://forexorbit-academy.onrender.com
   
   # Agora
   NEXT_PUBLIC_AGORA_APP_ID = your-agora-app-id
   AGORA_APP_CERTIFICATE = your-agora-app-certificate
   
   # Broker API (OANDA Demo)
   BROKER_TYPE = oanda
   BROKER_DEMO_MODE = true
   OANDA_API_KEY = your_oanda_practice_api_key
   OANDA_ACCOUNT_ID = your_oanda_practice_account_id
   OANDA_DEMO_URL = https://api-fxpractice.oanda.com
   ```

4. **Save and Redeploy:**
   - Click **Save Changes**
   - Render will automatically redeploy your service

## Getting OANDA Credentials

### Step 1: Create OANDA Practice Account

1. Visit: https://www.oanda.com/us-en/trading/forex-demo/
2. Click **"Open Practice Account"** or **"Try Demo"**
3. Fill in the registration form:
   - Email address
   - Password
   - Personal information
4. Verify your email address

### Step 2: Get Practice Account ID

1. Log in to your OANDA practice account
2. Go to **Account** or **Settings**
3. Find your **Account ID** (usually a number like `101-004-1234567-001`)
4. Copy this value - this is your `OANDA_ACCOUNT_ID`

### Step 3: Generate API Token

1. In your OANDA practice account, go to **Manage API Access** or **API Settings**
2. Click **"Generate API Token"** or **"Create Token"**
3. Select **"Practice Account"** (not Live)
4. Copy the generated token - this is your `OANDA_API_KEY`
5. **Important:** Save this token immediately - you won't be able to see it again!

### Step 4: Verify Practice API URL

- **Practice/Demo URL:** `https://api-fxpractice.oanda.com`
- **Live URL (DO NOT USE):** `https://api-fxtrade.oanda.com`

Make sure you're using the **practice** URL only!

## Security Best Practices

### ✅ DO:

- ✅ Store all secrets in environment variables
- ✅ Use different secrets for development and production
- ✅ Keep `.env.local` in `.gitignore` (already done)
- ✅ Use strong, random JWT secrets
- ✅ Rotate API keys periodically
- ✅ Set `BROKER_DEMO_MODE=true` always

### ❌ DON'T:

- ❌ Commit `.env.local` to git
- ❌ Share API keys in chat/email
- ❌ Use production API keys in development
- ❌ Set `BROKER_DEMO_MODE=false` (real trading not allowed)
- ❌ Expose API keys in client-side code
- ❌ Use the same JWT secret across environments

## Verifying Setup

### Check Local Development:

1. Restart your dev server: `npm run dev`
2. Check console for environment validation messages
3. Try accessing the demo trading page
4. Check browser console for any API errors

### Check Vercel:

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Verify all variables are set
3. Check deployment logs for any errors
4. Test the live site

### Check Render:

1. Go to Render Dashboard → Your Service → Environment
2. Verify all variables are set
3. Check service logs: `Logs` tab
4. Look for "✓ Environment variables validated" message

## Troubleshooting

### "OANDA_API_KEY not found"
- **Solution:** Make sure `OANDA_API_KEY` is set in your environment variables
- Check both Vercel and Render if using separate deployments

### "BROKER_DEMO_MODE must be true"
- **Solution:** Set `BROKER_DEMO_MODE=true` in all environments
- This is a security requirement - real trading is not allowed

### "Failed to create demo account"
- **Solution:** 
  - Verify OANDA credentials are correct
  - Check that you're using practice account credentials (not live)
  - Verify `OANDA_DEMO_URL` is set to practice URL
  - Check Render logs for detailed error messages

### Environment variables not updating
- **Solution:**
  - **Vercel:** Redeploy after adding variables
  - **Render:** Save changes and wait for auto-redeploy
  - **Local:** Restart dev server (`npm run dev`)

## Quick Reference

### Required for Broker Integration:
```env
BROKER_TYPE=oanda
BROKER_DEMO_MODE=true
OANDA_API_KEY=your_key_here
OANDA_ACCOUNT_ID=your_account_id_here
OANDA_DEMO_URL=https://api-fxpractice.oanda.com
```

### Where to Get OANDA Credentials:
- **Practice Account:** https://www.oanda.com/us-en/trading/forex-demo/
- **API Documentation:** https://developer.oanda.com/rest-live-v20/introduction/
- **Practice API Base:** https://api-fxpractice.oanda.com

## Support

If you encounter issues:
1. Check the error logs in Vercel/Render
2. Verify all environment variables are set correctly
3. Ensure you're using OANDA **practice** credentials (not live)
4. Check that `BROKER_DEMO_MODE=true` is set

