# Project Structure Explanation

## Frontend vs Backend

### This is a **Monorepo** (Single Codebase)
Your app uses **Next.js**, which combines frontend and backend in one project. There are **NO separate folders** for frontend and backend.

---

## Folder Structure

```
Inforex_app/
├── 📁 pages/                    # BOTH Frontend & Backend
│   ├── index.tsx                # Frontend: Landing page
│   ├── dashboard.tsx            # Frontend: Student dashboard
│   ├── courses/                 # Frontend: Course pages
│   └── api/                     # Backend: API routes (REST endpoints)
│       ├── auth/                # Backend: Authentication APIs
│       ├── courses/             # Backend: Course APIs
│       ├── lessons/             # Backend: Lesson APIs
│       └── ...
│
├── 📁 components/              # Frontend: React components
│   ├── Header.tsx
│   ├── Sidebar.tsx
│   └── ...
│
├── 📁 hooks/                   # Frontend: React hooks
│   ├── useAuth.tsx
│   ├── useCourses.ts
│   └── ...
│
├── 📁 lib/                     # Backend: Server utilities
│   ├── auth-middleware.ts      # Backend: Authentication
│   ├── mongodb.ts              # Backend: Database connection
│   └── ...
│
├── 📁 server.js                # Backend: Custom Node.js server (Socket.io)
├── 📁 package.json             # Dependencies for both
└── 📁 .env.local               # Environment variables (not in git)
```

---

## How It Works

### Frontend (Client-Side)
- **Location**: `pages/*.tsx` (except `pages/api/`)
- **What it does**: Displays UI, handles user interactions
- **Runs in**: Browser

### Backend (Server-Side)
- **Location**: `pages/api/`, `server.js`, `lib/`
- **What it does**: Handles API requests, database operations, Socket.io
- **Runs in**: Node.js server

---

## Deployment Answer

### ❌ You CANNOT separate them
- Frontend and backend are **tightly integrated**
- They **must be deployed together**

### ✅ Deployment Options

#### Option 1: Render (Recommended)
- **Deploy**: Entire project as one service
- **Command**: `npm start` (runs `server.js`)
- **Supports**: Full-stack + Socket.io
- **Cost**: Free tier available

#### Option 2: Netlify (Limited)
- **Deploy**: Entire project
- **Limitation**: Socket.io won't work
- **Cost**: Free tier available

---

## What Gets Deployed

When you deploy, you deploy **everything**:
- ✅ Frontend pages
- ✅ Backend API routes
- ✅ Custom server (`server.js`)
- ✅ All dependencies

**You don't need to separate anything!**

---

## Quick Answer

**Q: Which folder is frontend?**
A: `pages/` (except `pages/api/`), `components/`, `hooks/`

**Q: Which folder is backend?**
A: `pages/api/`, `server.js`, `lib/`

**Q: How do I deploy?**
A: Deploy the **entire project** to Render (recommended) or Netlify

**Q: Do I need separate deployments?**
A: No! Deploy everything as one service.

