# Quick Fix for Frontend Not Opening

## Issue
Frontend not opening at `http://localhost:3000`

## Solution Steps

### 1. Stop All Node Processes
```powershell
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
```

### 2. Verify .env.local File
Make sure `.env.local` exists in the project root with:
```env
MONGO_URI=mongodb+srv://Damian25:sopuluchukwu@cluster0.tcjhicx.mongodb.net/?appName=Cluster0
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production-min-32-chars
NEXT_PUBLIC_SOCKET_URL=http://localhost:3000
```

### 3. Start the Server
```powershell
npm run dev
```

### 4. Wait for Compilation
- First time: Wait 30-60 seconds for Next.js to compile
- Look for: `> Ready on http://localhost:3000`
- You should also see: `> MongoDB: Connected to Atlas cluster`

### 5. Open Browser
- Go to: `http://localhost:3000`
- You should see the home page

## If Still Not Working

### Check Server Logs
Look for errors in the terminal where you ran `npm run dev`

### Common Issues:
1. **Port in use**: Kill process on port 3000
2. **MongoDB connection**: Check internet connection and MongoDB Atlas IP whitelist
3. **TypeScript errors**: Check for compilation errors
4. **Missing dependencies**: Run `npm install`

### Alternative: Use Standard Next.js Dev Server
If custom server has issues, temporarily use:
```json
// In package.json, change:
"dev": "next dev"
```
Then run `npm run dev` (this won't have Socket.io, but frontend will work)

