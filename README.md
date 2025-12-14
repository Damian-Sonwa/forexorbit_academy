# Forex E-Learning Platform

A comprehensive e-learning platform for Forex trading with real-time features, interactive lessons, quizzes, and live market signals.

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

## Tech Stack

- **Frontend**: Next.js 14, React 18, TypeScript, TailwindCSS
- **Backend**: Next.js API Routes, MongoDB
- **Real-Time**: Socket.io
- **Authentication**: JWT
- **Video**: react-player
- **Charts**: recharts

## Setup Instructions

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment Variables**
   
   Create a `.env.local` file in the root directory:
   ```env
   MONGO_URI=mongodb+srv://Damian25:sopuluchukwu@cluster0.tcjhicx.mongodb.net/Forex_elearning?appName=Cluster0
   JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
   NEXT_PUBLIC_SOCKET_URL=http://localhost:3000
   ```

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
│   └── MarketSignal.tsx
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

## Notes

- The app validates environment variables on server startup
- MongoDB connection is reused across requests (singleton pattern)
- Socket.io requires JWT authentication
- All API routes are protected with authentication middleware
- Role-based access control for admin/instructor features

## Development

The app runs immediately after `npm install` and `npm run dev` provided:
1. `.env.local` file exists with required variables
2. MongoDB connection is accessible
3. All dependencies are installed

