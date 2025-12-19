# Troubleshooting Network Error: Failed to Load Profile Data

## Error Message
```
Failed to load profile data: 
Object { message: "Network Error", name: "AxiosError", code: "ERR_NETWORK", ... }
```

## Common Causes & Solutions

### 1. API Route Not Found (404)

**Symptoms:**
- Network error in browser console
- API route returns 404

**Solution:**
- Verify the API route exists: `pages/api/auth/me.ts`
- Check that the file is in the correct location
- Restart your development server: `npm run dev`

### 2. Database Connection Issue

**Symptoms:**
- Network error
- Server logs show database connection errors

**Solution:**
- Check `MONGO_URI` is set in `.env.local`:
  ```env
  MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/Forex_elearning
  ```
- Verify MongoDB connection string is correct
- Check MongoDB Atlas network access (IP whitelist)
- Test connection: Check server logs for MongoDB connection messages

### 3. Authentication Token Missing or Invalid

**Symptoms:**
- Network error or 401 Unauthorized
- Token not in localStorage

**Solution:**
- Check browser console: `localStorage.getItem('token')`
- If token is missing, log in again
- If token is invalid, clear localStorage and log in:
  ```javascript
  localStorage.clear();
  // Then log in again
  ```

### 4. CORS Issues (Production)

**Symptoms:**
- Network error in production
- Works in development but not production

**Solution:**
- Check `ALLOWED_ORIGINS` in environment variables
- Verify frontend URL is in allowed origins
- Check server.js CORS configuration

### 5. Server Not Running

**Symptoms:**
- Network error
- Cannot connect to server

**Solution:**
- **Local Development:**
  - Start dev server: `npm run dev`
  - Check server is running on correct port (usually 3000)
  
- **Production (Vercel/Render):**
  - Check deployment status
  - Verify environment variables are set
  - Check deployment logs for errors

### 6. API Base URL Configuration

**Symptoms:**
- Network error
- Requests going to wrong URL

**Solution:**
- Check `NEXT_PUBLIC_API_URL` in environment variables
- Default is `/api` (relative URL)
- For production, may need full URL:
  ```env
  NEXT_PUBLIC_API_URL=https://your-backend-url.com/api
  ```

## Debugging Steps

### Step 1: Check Browser Console

1. Open browser DevTools (F12)
2. Go to **Console** tab
3. Look for detailed error messages
4. Check **Network** tab to see the actual request:
   - URL being called
   - Request headers
   - Response status
   - Response body

### Step 2: Check Server Logs

**Local Development:**
- Check terminal where `npm run dev` is running
- Look for error messages

**Production:**
- **Vercel:** Dashboard → Project → Deployments → View Function Logs
- **Render:** Dashboard → Service → Logs

### Step 3: Test API Route Directly

**Using Browser:**
```
http://localhost:3000/api/auth/me
```
(Should return 401 if not authenticated, or user data if authenticated)

**Using curl:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:3000/api/auth/me
```

### Step 4: Verify Environment Variables

**Check `.env.local` exists and has:**
```env
MONGO_URI=mongodb+srv://...
JWT_SECRET=your-secret
```

**Verify in production:**
- Vercel: Settings → Environment Variables
- Render: Environment tab

### Step 5: Check Authentication

1. Open browser console
2. Run: `localStorage.getItem('token')`
3. If null, you need to log in
4. If token exists, verify it's valid:
   - Check expiration
   - Try logging out and back in

## Quick Fixes

### Fix 1: Clear Cache and Reload
```javascript
// In browser console
localStorage.clear();
sessionStorage.clear();
location.reload();
```

### Fix 2: Restart Development Server
```bash
# Stop server (Ctrl+C)
npm run dev
```

### Fix 3: Re-login
1. Log out
2. Clear browser cache
3. Log in again
4. Check if profile loads

### Fix 4: Check Network Tab
1. Open DevTools → Network tab
2. Filter by "XHR" or "Fetch"
3. Look for `/api/auth/me` request
4. Check:
   - Status code (200, 401, 404, 500)
   - Request URL
   - Response body

## Production-Specific Issues

### Vercel (Frontend)

**If API routes are on Vercel:**
- Check function logs
- Verify environment variables
- Check deployment status

**If API routes are on Render:**
- Verify `NEXT_PUBLIC_API_URL` points to Render URL
- Check Render service is running
- Verify CORS allows Vercel domain

### Render (Backend)

**Check:**
- Service is running (not sleeping)
- Environment variables are set
- Logs show no errors
- MongoDB connection is working

## Still Having Issues?

1. **Check Recent Changes:**
   - Did you recently update environment variables?
   - Did you change API routes?
   - Did you update dependencies?

2. **Compare Working vs Not Working:**
   - Does it work in development but not production?
   - Does it work for some users but not others?
   - Does it work sometimes but not always?

3. **Check Error Details:**
   - Full error message in console
   - Network request details
   - Server logs

4. **Common Solutions:**
   - Restart everything (dev server, browser)
   - Clear all caches
   - Re-login
   - Check environment variables
   - Verify database connection

## Prevention

To prevent this error:

1. ✅ Always set `MONGO_URI` in environment variables
2. ✅ Verify authentication token is valid
3. ✅ Check API routes exist and are accessible
4. ✅ Test API routes after deployment
5. ✅ Monitor server logs for errors
6. ✅ Use proper error handling in components

