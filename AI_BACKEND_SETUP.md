# AI Backend Setup Guide

## Overview

AI features are **ONLY** configured and run on the **Render backend**. They are **NEVER** exposed to the Vercel frontend.

## Environment Variables

### Render Backend (Required)

Add these environment variables in your Render dashboard:

```env
AI_API_KEY=sk-...                    # Your OpenAI API key (starts with sk-)
AI_MODEL=gpt-3.5-turbo               # Optional, defaults to gpt-3.5-turbo
AI_MAX_TOKENS=500                     # Optional, defaults to 500
AI_TEMPERATURE=0.7                    # Optional, defaults to 0.7
```

### Vercel Frontend (NOT Required)

**DO NOT** add `AI_API_KEY` to Vercel. The frontend will call the Render backend API endpoints which handle AI requests.

## API Endpoints

All AI endpoints are server-side only and run on Render:

- `GET /api/ai/health` - Health check (validates configuration)
- `GET /api/ai/check-config` - Check if AI is configured (for frontend display)
- `POST /api/ai/answer-question` - Answer student questions
- `POST /api/ai/task-hint` - Get task hints
- `POST /api/ai/analyze-trade` - Analyze demo trades
- `POST /api/ai/draft-feedback` - Draft instructor feedback

## Security

1. **AI_API_KEY is NEVER exposed to frontend**
   - Only exists in Render backend environment
   - Never in `next.config.js` env
   - Never in `NEXT_PUBLIC_*` variables

2. **Backend-only execution**
   - All AI functions check `typeof window === 'undefined'`
   - Frontend calls fail gracefully if attempted

3. **API key validation**
   - Checks for `sk-` prefix
   - Validates at runtime before use

## Health Check

Test AI configuration:

```bash
curl https://forexorbit-academy.onrender.com/api/ai/health
```

Expected response:
```json
{
  "configured": true,
  "hasApiKey": true,
  "apiKeyFormatValid": true,
  "model": "gpt-3.5-turbo",
  "maxTokens": 500,
  "temperature": 0.7,
  "environment": "production",
  "backend": true,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Troubleshooting

### "AI is not configured" message

1. **Check Render environment variables:**
   - Go to Render dashboard → Your service → Environment
   - Verify `AI_API_KEY` is set
   - Ensure it starts with `sk-`

2. **Verify backend is running:**
   - Check Render service logs
   - Look for `[AI] OpenAI client initialized successfully`

3. **Test health endpoint:**
   ```bash
   curl https://forexorbit-academy.onrender.com/api/ai/health
   ```

4. **Clear build cache:**
   - Render dashboard → Your service → Manual Deploy
   - Check "Clear build cache" → Deploy

### AI features not working

1. Check Render logs for AI errors
2. Verify API key is valid (test with OpenAI directly)
3. Check rate limits (OpenAI has usage limits)
4. Ensure backend service is running

## Implementation Details

- Uses official `openai` npm package (v6.15.0+)
- Client initialized once and cached
- Rate limiting: 10 requests/minute per user
- Response caching: 1 hour TTL
- All errors logged with `[AI]` prefix

## Deployment Checklist

- [ ] Add `AI_API_KEY` to Render environment variables
- [ ] Verify `AI_API_KEY` starts with `sk-`
- [ ] Deploy Render backend with cleared cache
- [ ] Test `/api/ai/health` endpoint
- [ ] Verify frontend shows "AI configured" status
- [ ] Test AI features (chat, hints, trade analysis)

