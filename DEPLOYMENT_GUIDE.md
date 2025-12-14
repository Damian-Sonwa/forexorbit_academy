# Deployment Guide for ForexOrbit Academy

## Project Structure

This is a **Next.js full-stack application** where frontend and backend are in the **same codebase**:

### Frontend (Client-Side)
- **Location**: `pages/`, `components/`, `hooks/`, `styles/`
- **Files**: 
  - `pages/index.tsx` - Landing page
  - `pages/dashboard.tsx` - Student dashboard
  - `pages/courses/` - Course pages
  - `components/` - React components
  - `hooks/` - Custom React hooks

### Backend (Server-Side)
- **Location**: `pages/api/`, `server.js`, `lib/`
- **Files**:
  - `pages/api/` - API routes (REST endpoints)
  - `server.js` - Custom Node.js server for Socket.io
  - `lib/` - Server utilities (auth, MongoDB, etc.)

### Important Notes
- **This is a monorepo** - frontend and backend are in the same project
- **Custom server required** - `server.js` is needed for Socket.io real-time features
- **Socket.io** - Used for real-time chat, progress updates, and market signals

---

## Deployment Options

### ⚠️ Important: Serverless Platform Limitations

**Vercel and Netlify do NOT support:**
- Custom Node.js servers (`server.js`)
- Socket.io persistent connections
- Real-time features (chat, live updates)

**If you deploy to Vercel/Netlify:**
- Real-time features will NOT work
- You'll need to disable Socket.io or use a separate service for Socket.io

---

## Recommended: Render Deployment (Full-Stack)

Render supports custom servers and Socket.io, making it ideal for this app.

### Step 1: Prepare for Render

1. **Ensure your code is pushed to GitHub**
   ```bash
   git add .
   git commit -m "Ready for deployment"
   git push origin master
   ```

2. **Update `render.yaml`** (already configured):
   - Update `NEXT_PUBLIC_SOCKET_URL` with your Render URL after deployment
   - Set your preferred region (oregon, frankfurt, singapore, etc.)

### Step 2: Deploy on Render

1. **Go to Render Dashboard**: https://dashboard.render.com
2. **Create New Web Service**:
   - Click "New +" → "Web Service"
   - Connect your GitHub repository: `Damian-Sonwa/forexorbit_academy`
   - Select branch: `master`

3. **Configure Service**:
   - **Name**: `forex-elearning-app` (or your preferred name)
   - **Environment**: `Node`
   - **Root Directory**: `.` (leave empty or set to `.` - this is the repository root)
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Choose `Starter` (free tier available but limited)

4. **Set Environment Variables** (in Render dashboard):
   ```
   NODE_ENV=production
   PORT=3000
   MONGO_URI=your_mongodb_atlas_connection_string
   JWT_SECRET=your_strong_random_secret_key
   NEXT_PUBLIC_SOCKET_URL=https://your-app-name.onrender.com
   ```

5. **Deploy**:
   - Click "Create Web Service"
   - Render will build and deploy your app
   - Wait for deployment to complete (5-10 minutes)

6. **Update Socket URL**:
   - After deployment, copy your Render URL
   - Update `NEXT_PUBLIC_SOCKET_URL` in Render environment variables
   - Redeploy if needed

### Step 3: Verify Deployment

- Visit your Render URL: `https://your-app-name.onrender.com`
- Test all features including real-time chat
- Check Socket.io connection in browser console

---

## Vercel Deployment (Recommended for Frontend, Socket.io Needs Separate Service)

Vercel is excellent for Next.js apps, but **Socket.io won't work** because Vercel uses serverless functions, not persistent servers.

### Option A: Vercel + Separate Socket.io Server (Recommended)

Deploy the main app to Vercel and run Socket.io on a separate service (Render).

#### Step 1: Deploy Main App to Vercel

1. **Go to Vercel Dashboard**: https://vercel.com
2. **Import Project**:
   - Click "Add New" → "Project"
   - Import from GitHub: `Damian-Sonwa/forexorbit_academy`
   - Select branch: `master`

3. **Configure Project**:
   - **Framework Preset**: Next.js (auto-detected)
   - **Root Directory**: `./` (root)
   - **Build Command**: `npm run build` (auto-detected)
   - **Output Directory**: `.next` (auto-detected)
   - **Install Command**: `npm install`

4. **Environment Variables** (in Vercel dashboard):
   ```
   NODE_ENV=production
   MONGO_URI=your_mongodb_atlas_connection_string
   JWT_SECRET=your_strong_random_secret_key
   NEXT_PUBLIC_SOCKET_URL=https://your-socket-server.onrender.com
   ```

5. **Deploy**:
   - Click "Deploy"
   - Wait for build to complete (2-5 minutes)

#### Step 2: Deploy Socket.io Server to Render

1. **Create a separate Socket.io service** on Render:
   - Use the same GitHub repo
   - Build Command: `npm install`
   - Start Command: `node server.js` (or create a minimal Socket.io server)
   - Set the same environment variables

2. **Update `NEXT_PUBLIC_SOCKET_URL`** in Vercel to point to your Render Socket.io service

### Option B: Vercel Only (Socket.io Disabled)

If you don't need real-time features:

1. **Follow Step 1 above** (deploy to Vercel)
2. **Disable Socket.io** in your code:
   - Comment out Socket.io connections in `hooks/useSocket.ts`
   - Remove Socket.io dependencies (optional)
   - Update components that use Socket.io

**Note**: Real-time chat, progress updates, and market signals will NOT work.

### Vercel Configuration

The `vercel.json` file is already configured with:
- API route handling
- Function timeouts (30 seconds)
- Proper routing

### Vercel Advantages

✅ Excellent Next.js support  
✅ Fast global CDN  
✅ Automatic HTTPS  
✅ Free tier with generous limits  
✅ Easy GitHub integration  
✅ Preview deployments for PRs  

### Vercel Limitations

❌ No custom Node.js servers (`server.js` won't run)  
❌ No Socket.io persistent connections  
❌ Serverless functions (not persistent)  
❌ 30-second function timeout limit  

---

## Alternative: Netlify Deployment (Limited Functionality)

If you still want to use Netlify (without Socket.io):

### Step 1: Disable Socket.io Features

You'll need to:
1. Remove or comment out Socket.io code
2. Convert to Next.js static export or API routes only
3. Use a separate service for Socket.io (e.g., separate Render service)

### Step 2: Deploy to Netlify

1. **Go to Netlify Dashboard**: https://app.netlify.com
2. **New Site from Git**:
   - Connect GitHub repository
   - Select branch: `master`

3. **Build Settings**:
   - **Build command**: `npm run build`
   - **Publish directory**: `.next`

4. **Environment Variables**:
   ```
   MONGO_URI=your_mongodb_atlas_connection_string
   JWT_SECRET=your_strong_random_secret_key
   NEXT_PUBLIC_SOCKET_URL=your_external_socket_server_url
   ```

5. **Deploy**:
   - Click "Deploy site"
   - Wait for build to complete

**Note**: Real-time features will NOT work on Netlify.

---

## Environment Variables Required

Both platforms need these environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `MONGO_URI` | MongoDB Atlas connection string | `mongodb+srv://user:pass@cluster.mongodb.net/db` |
| `JWT_SECRET` | Secret key for JWT tokens | Generate with: `node scripts/generate-jwt-secret.js` |
| `NEXT_PUBLIC_SOCKET_URL` | Socket.io server URL | `https://your-app.onrender.com` |
| `NODE_ENV` | Environment mode | `production` |
| `PORT` | Server port | `3000` (Render auto-assigns) |

---

## Quick Deploy Commands

### Render (Recommended)
```bash
# 1. Push to GitHub
git push origin master

# 2. Go to Render dashboard and create web service
# 3. Connect GitHub repo
# 4. Set environment variables
# 5. Deploy!
```

### Netlify (Limited)
```bash
# 1. Push to GitHub
git push origin master

# 2. Go to Netlify dashboard
# 3. New site from Git
# 4. Set environment variables
# 5. Deploy!
```

---

## Troubleshooting

### Render Issues
- **Build fails**: Check Node version (should be 20+)
- **Socket.io not working**: Verify `NEXT_PUBLIC_SOCKET_URL` matches your Render URL
- **MongoDB connection fails**: Check `MONGO_URI` and MongoDB Atlas IP whitelist

### Netlify Issues
- **Socket.io errors**: Expected - Netlify doesn't support Socket.io
- **API routes not working**: Check build settings and environment variables

---

## Recommended Architecture

### Best Option: Single Service (Render)
- **Frontend + Backend + Socket.io**: Deploy to **Render** (single service)
- ✅ Everything works together
- ✅ Socket.io works perfectly
- ✅ Simpler setup

### Alternative: Split Architecture
- **Frontend**: Vercel (excellent Next.js support)
- **Backend API**: Vercel (API routes work fine)
- **Socket.io Server**: Separate Render service
- ⚠️ More complex setup
- ⚠️ Need to manage two services
- ✅ Best performance for frontend

---

## Support

For deployment issues:
1. Check Render/Netlify logs
2. Verify environment variables
3. Test locally first: `npm run dev`
4. Check MongoDB Atlas connection

