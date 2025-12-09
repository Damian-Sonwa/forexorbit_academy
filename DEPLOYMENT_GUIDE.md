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

### ⚠️ Important: Netlify Limitations

**Netlify does NOT support:**
- Custom Node.js servers (`server.js`)
- Socket.io persistent connections
- Real-time features (chat, live updates)

**If you deploy to Netlify:**
- Real-time features will NOT work
- You'll need to disable Socket.io or use a separate service

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

For best results:
- **Frontend + Backend + Socket.io**: Deploy to **Render** (single service)
- **OR**: 
  - Frontend: Netlify
  - Backend API: Render
  - Socket.io Server: Separate Render service

---

## Support

For deployment issues:
1. Check Render/Netlify logs
2. Verify environment variables
3. Test locally first: `npm run dev`
4. Check MongoDB Atlas connection

