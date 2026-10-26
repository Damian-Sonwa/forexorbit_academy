# Broker API Integration Setup Guide

## Quick Start: OANDA Demo API Setup

This guide walks you through setting up the OANDA broker API integration for demo trading.

## Step 1: Create OANDA Practice Account

1. **Visit OANDA Demo Registration:**
   - Go to: https://hub.oanda.com/apply/demo/
   - Click **"Open Practice Account"** or **"Try Demo"**

2. **Fill in Registration Form:**
   - Email address
   - Password (create a strong password)
   - First Name
   - Last Name
   - Country
   - Phone number (optional)

3. **Verify Your Email:**
   - Check your email inbox
   - Click the verification link from OANDA
   - Complete email verification

4. **Complete Account Setup:**
   - Log in to your OANDA practice account
   - Complete any additional profile information if prompted

## Step 2: Get Your Practice Account ID

1. **Log in to OANDA Practice Account:**
   - Visit: https://hub.oanda.com/apply/demo/
   - Log in with your credentials

2. **Find Your Account ID:**
   - After logging in, look for your **Account ID** in one of these places:
     - **Dashboard/Home Page:** Usually displayed at the top
     - **Account Settings:** Go to Settings → Account Information
     - **Trading Platform:** If you open the WebTrader, it may show in the URL or account info
   
   **Format:** Usually looks like `101-004-1234567-001` or similar

3. **Copy Your Account ID:**
   - This is your `OANDA_ACCOUNT_ID` value
   - Save it somewhere safe (you'll need it for environment variables)

## Step 3: Generate API Token

1. **Navigate to API Settings:**
   - Log in to your OANDA practice account
   - Go to: **Account** → **Manage API Access** 
   - Or visit: https://www.oanda.com/account/tpa/personal_access_tokens

2. **Create New Token:**
   - Click **"Generate API Token"** or **"Create Token"**
   - **IMPORTANT:** Make sure you're creating a token for your **PRACTICE/DEMO account**, not live account
   - Give it a descriptive name (e.g., "ForexOrbit Academy Demo")

3. **Copy the Token:**
   - The token will be displayed once (you won't see it again!)
   - **Copy it immediately** - this is your `OANDA_API_KEY`
   - Save it securely (password manager recommended)

4. **Token Permissions:**
   - The token should have permissions for:
     - View account information
     - Place orders
     - View positions
     - View pricing

## Step 4: Verify Practice API URL

- **Practice/Demo API URL:** `https://api-fxpractice.oanda.com`
- **Live API URL (DO NOT USE):** `https://api-fxtrade.oanda.com`

**⚠️ CRITICAL:** Always use the **practice** URL. Never use the live URL.

## Step 5: Set Environment Variables

### For Local Development (.env.local)

Create or edit `.env.local` in your project root:

```env
# Broker API Configuration
BROKER_TYPE=oanda
BROKER_DEMO_MODE=true
OANDA_API_KEY=your_copied_api_token_here
OANDA_ACCOUNT_ID=your_account_id_here
OANDA_DEMO_URL=https://api-fxpractice.oanda.com
```

**Example:**
```env
BROKER_TYPE=oanda
BROKER_DEMO_MODE=true
OANDA_API_KEY=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
OANDA_ACCOUNT_ID=101-004-1234567-001
OANDA_DEMO_URL=https://api-fxpractice.oanda.com
```

### For Vercel (Frontend)

1. Go to: https://vercel.com/dashboard
2. Select your project → **Settings** → **Environment Variables**
3. Add each variable:

   ```
   BROKER_TYPE = oanda
   BROKER_DEMO_MODE = true
   OANDA_API_KEY = your_api_token
   OANDA_ACCOUNT_ID = your_account_id
   OANDA_DEMO_URL = https://api-fxpractice.oanda.com
   ```

4. Select environments: ✅ Production, ✅ Preview
5. Click **Save**
6. **Redeploy** your project

### For Render (Backend)

1. Go to: https://dashboard.render.com
2. Select your web service → **Environment** tab
3. Click **Add Environment Variable**
4. Add each variable:

   ```
   BROKER_TYPE = oanda
   BROKER_DEMO_MODE = true
   OANDA_API_KEY = your_api_token
   OANDA_ACCOUNT_ID = your_account_id
   OANDA_DEMO_URL = https://api-fxpractice.oanda.com
   ```

5. Click **Save Changes**
6. Render will automatically redeploy

## Step 6: Test the Integration

### Test Account Creation

1. Start your local dev server: `npm run dev`
2. Log in as a student
3. Go to **Demo Trading** → **Live Trading** tab
4. Click **"Create Demo Account"**
5. Check browser console and server logs for any errors

### Test Order Placement

1. After account is created, click **"+ Place Order"**
2. Fill in order details:
   - Instrument: EUR_USD
   - Side: Buy
   - Units: 1000
   - Order Type: Market
3. Click **"Place Order"**
4. Check if order appears in "Open Positions" or "Recent Orders"

### Common Issues

**Error: "OANDA_API_KEY not found"**
- ✅ Check that `OANDA_API_KEY` is set in environment variables
- ✅ Restart dev server after adding variables
- ✅ Verify variable name is exactly `OANDA_API_KEY` (case-sensitive)

**Error: "OANDA_ACCOUNT_ID not found"**
- ✅ Check that `OANDA_ACCOUNT_ID` is set
- ✅ Verify you're using your practice account ID (not live)

**Error: "Only demo accounts are allowed"**
- ✅ Verify `BROKER_DEMO_MODE=true` is set
- ✅ Check that you're using practice API URL

**Error: "Invalid API key" or "401 Unauthorized"**
- ✅ Verify your API token is correct (copy-paste error?)
- ✅ Check that token is for practice account (not live)
- ✅ Regenerate token if needed

**Error: "Account not found"**
- ✅ Verify `OANDA_ACCOUNT_ID` matches your practice account ID
- ✅ Check that account ID format is correct

## Step 7: Verify Security

### ✅ Security Checklist

- [ ] `BROKER_DEMO_MODE=true` is set in all environments
- [ ] Using practice API URL (`api-fxpractice.oanda.com`)
- [ ] Using practice account credentials (not live)
- [ ] API keys are in environment variables (not hardcoded)
- [ ] `.env.local` is in `.gitignore` (already done)
- [ ] No credentials committed to Git

## Optional: Test API Connection Manually

You can test your OANDA API connection using curl:

```bash
# Test account info (replace YOUR_TOKEN and YOUR_ACCOUNT_ID)
curl -H "Authorization: Bearer YOUR_TOKEN" \
     https://api-fxpractice.oanda.com/v3/accounts/YOUR_ACCOUNT_ID
```

If successful, you'll get account information in JSON format.

## Troubleshooting

### API Token Not Working

1. **Regenerate Token:**
   - Go to OANDA → Manage API Access
   - Revoke old token
   - Generate new token
   - Update environment variables

2. **Check Token Permissions:**
   - Ensure token has "Trading" permissions
   - Some tokens may be read-only

### Account ID Issues

1. **Verify Account Type:**
   - Make sure you're using practice account ID
   - Practice accounts usually start with `101-` or similar
   - Live accounts have different prefixes

2. **Get Account ID from API:**
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
        https://api-fxpractice.oanda.com/v3/accounts
   ```
   This lists all your practice accounts with their IDs.

### Environment Variables Not Loading

1. **Local Development:**
   - Restart dev server: `npm run dev`
   - Check `.env.local` file exists in project root
   - Verify variable names are exact (case-sensitive)

2. **Vercel:**
   - Go to project settings → Environment Variables
   - Verify variables are set
   - Redeploy after adding variables

3. **Render:**
   - Check Environment tab
   - Save changes (triggers redeploy)
   - Check logs for environment variable errors

## Next Steps

Once setup is complete:

1. ✅ Test account creation
2. ✅ Test placing a market order
3. ✅ Test viewing positions
4. ✅ Test closing positions
5. ✅ Check performance metrics
6. ✅ Verify all trades are demo only

## Support Resources

- **OANDA API Documentation:** https://developer.oanda.com/rest-live-v20/introduction/
- **OANDA Practice Account:** https://hub.oanda.com/apply/demo/
- **OANDA API Token Management:** https://www.oanda.com/account/tpa/personal_access_tokens

## Security Reminders

⚠️ **NEVER:**
- Use live trading credentials
- Commit API keys to Git
- Share API tokens
- Set `BROKER_DEMO_MODE=false`

✅ **ALWAYS:**
- Use practice/demo credentials only
- Store keys in environment variables
- Keep tokens secure
- Verify `BROKER_DEMO_MODE=true`

