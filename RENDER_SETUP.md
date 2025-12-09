# Render Deployment - Quick Setup Guide

## Root Directory for Render

**Answer: `.` (dot) or leave it EMPTY**

Since your `package.json`, `server.js`, and all project files are at the repository root, the root directory should be:
- **`.`** (dot - means current directory/root)
- **OR leave it empty** (Render defaults to repository root)

---

## Step-by-Step Render Setup

### 1. Go to Render Dashboard
- Visit: https://dashboard.render.com
- Sign up/Login with GitHub

### 2. Create New Web Service
- Click **"New +"** → **"Web Service"**
- Connect your GitHub repository: `Damian-Sonwa/forexorbit_academy`
- Select branch: `master`

### 3. Configure Settings

#### Basic Settings:
- **Name**: `forex-elearning-app` (or your preferred name)
- **Region**: Choose closest to your users (oregon, frankfurt, singapore, etc.)
- **Branch**: `master`
- **Root Directory**: **`.`** (dot) or **leave empty**
- **Runtime**: `Node`
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`
- **Plan**: `Starter` (free tier) or `Standard` (recommended for production)

#### Environment Variables:
Click "Advanced" → "Add Environment Variable" and add:

```
NODE_ENV=production
PORT=3000
MONGO_URI=your_mongodb_atlas_connection_string
JWT_SECRET=your_strong_random_secret_key
NEXT_PUBLIC_SOCKET_URL=https://your-app-name.onrender.com
```

**Important**: 
- Replace `your-app-name` with your actual Render service name
- Get `MONGO_URI` from MongoDB Atlas
- Generate `JWT_SECRET` using: `node scripts/generate-jwt-secret.js`

### 4. Deploy
- Click **"Create Web Service"**
- Render will:
  1. Clone your repository
  2. Install dependencies (`npm install`)
  3. Build the app (`npm run build`)
  4. Start the server (`npm start`)
- Wait 5-10 minutes for first deployment

### 5. Update Socket URL
After deployment:
1. Copy your Render URL (e.g., `https://forex-elearning-app.onrender.com`)
2. Go to Environment Variables in Render dashboard
3. Update `NEXT_PUBLIC_SOCKET_URL` with your actual URL
4. Save and redeploy (or wait for auto-deploy)

---

## Root Directory Explained

### What is Root Directory?
The root directory tells Render where your `package.json` file is located.

### For Your Project:
```
Inforex_app/                    ← This is the ROOT
├── package.json                ← Render looks for this
├── server.js                   ← Your custom server
├── render.yaml                 ← Render config
├── pages/                      ← Next.js pages
├── components/                 ← React components
├── lib/                        ← Server utilities
└── ...
```

Since everything is at the root level:
- **Root Directory**: `.` (dot) or **empty**
- This means: "Use the repository root"

### If Your Project Was in a Subfolder:
If your project was in a subfolder like `app/`:
- **Root Directory**: `app`
- Render would look for `app/package.json`

---

## Verification Checklist

After deployment, verify:

- [ ] Build completed successfully
- [ ] Service is "Live" (green status)
- [ ] Can access: `https://your-app.onrender.com`
- [ ] MongoDB connection works
- [ ] Socket.io connects (check browser console)
- [ ] Authentication works
- [ ] API routes respond

---

## Common Issues

### Build Fails
- **Check**: Root directory is set to `.` or empty
- **Check**: `package.json` exists at root
- **Check**: Node version (should be 18+)

### Socket.io Not Working
- **Check**: `NEXT_PUBLIC_SOCKET_URL` matches your Render URL
- **Check**: Environment variable is set correctly
- **Check**: Service is using `npm start` (not `npm run dev`)

### MongoDB Connection Fails
- **Check**: `MONGO_URI` is correct
- **Check**: MongoDB Atlas IP whitelist includes Render IPs (0.0.0.0/0 for all)
- **Check**: MongoDB Atlas network access is enabled

---

## Quick Reference

| Setting | Value |
|---------|-------|
| Root Directory | `.` or empty |
| Build Command | `npm install && npm run build` |
| Start Command | `npm start` |
| Runtime | Node |
| Port | 3000 (auto-assigned by Render) |

---

## Using render.yaml (Auto-Deploy)

If you use the `render.yaml` file:
- Render will auto-detect settings from the file
- Root directory defaults to repository root
- You still need to set environment variables in the dashboard

---

## Need Help?

1. Check Render build logs
2. Check Render service logs
3. Verify environment variables
4. Test locally first: `npm run dev`

