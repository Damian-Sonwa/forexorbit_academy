# Forex E-Learning Platform

A comprehensive e-learning platform for Forex trading with real-time features, interactive lessons, quizzes, and live market signals.

<!-- Last updated: Enhanced email logging and diagnostics for password reset -->

## Features

### Core Features
- **Authentication & Roles**: JWT-based authentication with admin, instructor, and student roles
- **Courses**: Course listing, detail pages, enrollment, and progress tracking
- **Lessons**: Video lessons with rich text descriptions and navigation
- **Quizzes**: Multiple choice quizzes with auto-grading
- **Student Dashboard**: Progress tracking, enrolled courses, and statistics
- **Admin Panel**: Course/lesson/quiz management and analytics

### Real-Time Features
- **Chat**: Lesson-specific chat rooms with real-time messaging
- **Progress Updates**: Real-time progress tracking and updates
- **Market Signals**: Live Forex market signals with mini charts
- **Expert Consultation**: Live chat with instructors, including voice and video calls via Agora SDK

## Tech Stack

- **Frontend**: Next.js 14, React 18, TypeScript, TailwindCSS
- **Backend**: Next.js API Routes, MongoDB
- **Real-Time**: Socket.io
- **Voice/Video Calls**: Agora RTC SDK (agora-rtc-sdk-ng)
- **Authentication**: JWT (jsonwebtoken, bcryptjs)
- **Video Player**: react-player
- **Charts**: recharts
- **HTTP Client**: axios
- **Date Utilities**: date-fns
- **File Upload**: formidable

## Setup Instructions

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment Variables**
   
   Create a `.env.local` file in the root directory:
   ```env
   MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/Forex_elearning?retryWrites=true&w=majority
   JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
   NEXT_PUBLIC_SOCKET_URL=http://localhost:3000
   NEXT_PUBLIC_AGORA_APP_ID=your-agora-app-id
   AGORA_APP_CERTIFICATE=your-agora-app-certificate
   # AGORA_APP_CERTIFICATE should be set on Render backend only, not in Vercel
   ```
   
   **⚠️ SECURITY WARNING:** Never commit `.env.local` to git. It's already in `.gitignore`.
   
   **Note**: To get Agora credentials:
   1. Sign up at [Agora Console](https://console.agora.io/)
   2. Create a new project
   3. Copy your App ID and App Certificate
   4. Add them to your `.env.local` file

3. **Run Development Server**
   ```bash
   npm run dev
   ```
   
   Note: The app uses a custom server (server.js) for Socket.io integration. Make sure your `.env.local` file is properly configured before starting.

4. **Open Browser**
   Navigate to `http://localhost:3000`

## Project Structure

```
├── components/          # React components
│   ├── Header.tsx
│   ├── Footer.tsx
│   ├── Sidebar.tsx
│   ├── CourseCard.tsx
│   ├── VideoPlayer.tsx
│   ├── Chat.tsx
│   ├── Quiz.tsx
│   ├── MarketSignal.tsx
│   └── AgoraCall.tsx
├── hooks/              # Custom React hooks
│   ├── useAuth.ts
│   ├── useCourses.ts
│   ├── useLesson.ts
│   ├── useProgress.ts
│   └── useSocket.ts
├── lib/                # Utility libraries
│   ├── mongodb.ts      # MongoDB connection
│   ├── jwt.ts          # JWT utilities
│   ├── api-client.ts   # API client
│   ├── auth-middleware.ts
│   └── env.ts          # Environment validation
├── pages/              # Next.js pages
│   ├── api/            # API routes
│   │   ├── auth/
│   │   ├── courses/
│   │   ├── lessons/
│   │   ├── quizzes/
│   │   ├── progress/
│   │   ├── messages/
│   │   ├── consultations/
│   │   └── admin/
│   ├── index.tsx       # Home page
│   ├── login.tsx
│   ├── signup.tsx
│   ├── dashboard.tsx
│   ├── admin/
│   └── courses/
├── server/              # Server utilities
│   └── socket.ts       # Socket.io setup
└── styles/             # Global styles
    └── globals.css
```

## API Endpoints

### Authentication
- `POST /api/auth/signup` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user

### Courses
- `GET /api/courses` - List all courses
- `POST /api/courses` - Create course (admin/instructor)
- `GET /api/courses/[id]` - Get course details
- `PUT /api/courses/[id]` - Update course (admin/instructor)
- `DELETE /api/courses/[id]` - Delete course (admin)
- `POST /api/courses/[id]/enroll` - Enroll in course
- `DELETE /api/courses/[id]/enroll` - Unenroll from course

### Lessons
- `GET /api/lessons?courseId=...` - List lessons
- `POST /api/lessons` - Create lesson (admin/instructor)
- `GET /api/lessons/[id]` - Get lesson details
- `PUT /api/lessons/[id]` - Update lesson (admin/instructor)
- `DELETE /api/lessons/[id]` - Delete lesson (admin/instructor)

### Quizzes
- `GET /api/quizzes/[lessonId]` - Get quiz
- `POST /api/quizzes/[lessonId]` - Submit quiz
- `PUT /api/quizzes/[lessonId]` - Create/update quiz (admin/instructor)

### Progress
- `GET /api/progress` - Get user progress
- `POST /api/progress` - Update progress

### Messages
- `GET /api/messages?lessonId=...` - Get messages
- `POST /api/messages` - Send message

### Consultations
- `GET /api/consultations` - List consultations
- `POST /api/consultations` - Create consultation request
- `GET /api/consultations/[id]` - Get consultation details
- `PUT /api/consultations/[id]` - Update consultation (approve/reject)
- `POST /api/consultations/agora-token` - Generate Agora RTC token for voice/video calls

### Admin
- `GET /api/admin/analytics` - Get analytics (admin only)

## Socket.io Events

### Client → Server
- `joinLesson` - Join lesson chat room
- `leaveLesson` - Leave lesson chat room
- `chatMessage` - Send chat message
- `progressUpdate` - Update lesson progress

### Server → Client
- `chatMessage` - Receive chat message
- `progressUpdated` - Progress update confirmation
- `marketSignal` - Live market signal
- `studentProgress` - Student progress update (instructor/admin)

## MongoDB Collections

- `users` - User accounts
- `courses` - Course data
- `lessons` - Lesson content
- `quizzes` - Quiz questions and answers
- `progress` - User progress tracking
- `messages` - Chat messages
- `quizScores` - Quiz submission scores

## Environment Variables

- `MONGO_URI` - MongoDB connection string (required)
- `JWT_SECRET` - Secret key for JWT tokens (required)
- `NEXT_PUBLIC_SOCKET_URL` - Socket.io server URL (optional, defaults to localhost:3000)
- `AGORA_APP_ID` - Agora App ID for voice/video calls (required for consultation calls)
- `AGORA_APP_CERTIFICATE` - Agora App Certificate for token generation (set on Render backend only, NOT in Vercel)

## Deployment

This app is configured for deployment on **Render** (recommended) and **Netlify**.

### Quick Deploy to Render

1. Push your code to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com)
3. Click "New +" → "Blueprint" (or "Web Service")
4. Connect your GitHub repository
5. Render will auto-detect `render.yaml` configuration
6. Set environment variables:
   - `MONGO_URI` - Your MongoDB connection string
   - `JWT_SECRET` - Generate with: `node scripts/generate-jwt-secret.js`
   - `NEXT_PUBLIC_SOCKET_URL` - Your Render app URL (update after first deploy)
   - `AGORA_APP_ID` - Your Agora App ID (get from [Agora Console](https://console.agora.io/))
   - `AGORA_APP_CERTIFICATE` - Your Agora App Certificate (set on Render backend only)
7. Deploy!

### Generate JWT Secret

```bash
node scripts/generate-jwt-secret.js
```

### Important Notes

- **Socket.io Requirement**: This app uses Socket.io for real-time features. Socket.io requires a persistent server connection.
- **Render Recommended**: Render supports persistent Node.js servers with Socket.io. Netlify has limitations with Socket.io.
- **Full Deployment Guide**: See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions.

## Key Features & Tools

### Voice & Video Calls (Agora SDK)
- **Expert Consultation Calls**: Students can request consultations with instructors
- **Real-time Communication**: Voice and video calls powered by Agora RTC SDK
- **Token-based Security**: Secure token generation for each call session
- **Component**: `components/AgoraCall.tsx` handles all Agora SDK integration
- **API Endpoint**: `/api/consultations/agora-token` generates secure tokens

### Real-time Chat (Socket.io)
- **Lesson Chat Rooms**: Real-time messaging during lessons
- **Community Chat**: Global chat rooms for students and instructors
- **WebSocket Support**: Full WebSocket (wss) support for production

### Authentication & Security
- **JWT Tokens**: Secure authentication with jsonwebtoken
- **Password Hashing**: bcryptjs for secure password storage
- **Role-based Access**: Admin, Instructor, and Student roles

### Data Management
- **MongoDB**: Primary database for all application data
- **File Uploads**: Formidable for handling file uploads
- **Date Handling**: date-fns for date formatting and manipulation

## Notes

- The app validates environment variables on server startup
- MongoDB connection is reused across requests (singleton pattern)
- Socket.io requires JWT authentication
- All API routes are protected with authentication middleware
- Role-based access control for admin/instructor features
- Agora SDK requires valid App ID and Certificate for voice/video calls

## Development

The app runs immediately after `npm install` and `npm run dev` provided:
1. `.env.local` file exists with required variables
2. MongoDB connection is accessible
3. All dependencies are installed

