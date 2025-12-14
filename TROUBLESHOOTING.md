# Troubleshooting Guide

## Frontend Not Opening at localhost:3000

### Common Issues and Solutions

#### 1. Port Already in Use
**Error**: `EADDRINUSE: address already in use :::3000`

**Solution**:
```powershell
# Find and kill process on port 3000
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
# Or find specific process
netstat -ano | findstr :3000
# Then kill with: taskkill /PID <process_id> /F
```

#### 2. MONGO_URI Not Defined
**Error**: `❌ Error: MONGO_URI not defined in .env.local`

**Solution**:
1. Check if `.env.local` exists in project root
2. Ensure it contains:
   ```env
   MONGO_URI=mongodb+srv://Damian25:sopuluchukwu@cluster0.tcjhicx.mongodb.net/?appName=Cluster0
   JWT_SECRET=your-super-secret-jwt-key-change-this-in-production-min-32-chars
   NEXT_PUBLIC_SOCKET_URL=http://localhost:3000
   ```
3. Restart the server after updating `.env.local`

#### 3. MongoDB Connection Issues
**Error**: Connection timeout or authentication failed

**Solutions**:
- Verify MongoDB Atlas IP whitelist includes `0.0.0.0/0` (for development)
- Check username/password in connection string
- Verify network connectivity to MongoDB Atlas

#### 4. Server Not Starting
**Check**:
1. All dependencies installed: `npm install`
2. Environment variables set correctly
3. No syntax errors in `server.js`
4. Port 3000 is available

### Verification Steps

1. **Check if server is running**:
   ```powershell
   netstat -ano | findstr :3000
   ```

2. **Check server logs**:
   Look for:
   ```
   > Ready on http://localhost:3000
   > MongoDB: Connected to Atlas cluster
   > Database: Forex_elearning
   ```

3. **Test in browser**:
   - Open: `http://localhost:3000`
   - Should see the home page

4. **Check API endpoints**:
   - `http://localhost:3000/api/courses` - Should return JSON

### Quick Fix Commands

```powershell
# Stop all Node processes
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force

# Verify .env.local exists and has content
Get-Content .env.local

# Start server
npm run dev

# Check if running
netstat -ano | findstr :3000
```

### Still Not Working?

1. Check Windows Firewall - ensure port 3000 is allowed
2. Try a different port - change `PORT=3001` in `.env.local`
3. Check Next.js build - run `npm run build` to check for errors
4. Clear `.next` folder - delete `.next` and restart

