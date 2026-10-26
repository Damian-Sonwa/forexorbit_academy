# AI Features Location Guide

This document shows where all AI features are located in the frontend.

## 🎓 Student Features

### 1. AI Learning Assistant Panel
**Location:** Student Dashboard (`/student-dashboard`)
- **Tab Name:** "AI Assistant" (🤖 icon)
- **How to Access:**
  1. Go to `/student-dashboard`
  2. Look for the navigation tabs at the top
  3. Click the "AI Assistant" tab (last tab, with 🤖 icon)
  4. The AI chat interface will appear

**Features:**
- Chat-style interface
- Ask questions about Forex trading
- Context-aware responses based on your level

### 2. AI Trade Feedback
**Location:** Trade Journal (`/student-dashboard` → Journal tab)
- **How to Access:**
  1. Go to `/student-dashboard`
  2. Click "Trade Journal" tab
  3. Submit a new trade entry
  4. AI feedback will automatically appear below the trade details

**Features:**
- Auto-generated on trade submission
- Shows strengths, mistakes, suggestions, and risk-reward analysis
- Displayed in a blue gradient card with 🤖 icon

### 3. AI Task Hints
**Location:** Task Detail Page (`/student-dashboard/tasks/[id]`)
- **How to Access:**
  1. Go to `/student-dashboard`
  2. Click "Tasks" tab
  3. Click "View Task" on any pending task
  4. Look for "Ask AI for Hint" button in the Instructions section

**Features:**
- Blue gradient button with 🤖 icon
- Provides level-appropriate hints
- Does not give direct answers

## 👨‍🏫 Instructor Features

### 4. AI Draft Feedback
**Location:** Instructor Demo Tasks → Review Submissions
- **How to Access:**
  1. Go to `/instructor/demo-tasks`
  2. Click on "Review Submissions" tab
  3. Click "Review" on any submission
  4. Look for "🤖 AI Draft Feedback" button above the feedback textarea

**Features:**
- Drafts feedback based on student submission
- Editable before submission
- Requires instructor confirmation

### 5. AI Student Analytics
**Location:** Instructor Dashboard (Component available)
- **Component:** `components/instructor/AIAnalytics.tsx`
- **How to Use:**
  - Can be integrated into instructor dashboard
  - Call with student ID to get performance analysis

## 💬 Community Features

### 6. AI Community Assistant
**Location:** Community Chat (`/community`)
- **How to Access:**
  1. Go to `/community`
  2. Select a room
  3. Start typing a message
  4. A 🤖 "Ask AI" button will appear next to the textarea
  5. Click it to get AI answer (will be posted as a message)

**Features:**
- On-demand only (no unsolicited messages)
- Responses clearly marked with "🤖 AI Assistant" prefix
- Answers general Forex questions

## ⚙️ Configuration

All AI features require `AI_API_KEY` environment variable to be set.

If AI is not configured:
- Features will still be visible
- Will show "AI Not Configured" warning
- Buttons will be disabled
- Error messages will appear when trying to use

## 🔍 Troubleshooting

If you can't see AI features:

1. **AI Assistant Tab Missing:**
   - Check you're on `/student-dashboard` (not `/dashboard`)
   - Look for the tab navigation at the top
   - Scroll horizontally if on mobile

2. **AI Hint Button Missing:**
   - Make sure you're viewing a task detail page
   - Check that the task has instructions
   - Button is in the Instructions section header

3. **AI Draft Feedback Missing:**
   - Make sure you're an instructor
   - Go to Demo Tasks → Review Submissions
   - Click "Review" on a submission first

4. **Community AI Button Missing:**
   - Make sure you're in a room (not room selection)
   - Start typing in the message input
   - Button only appears when there's text

5. **AI Trade Feedback Missing:**
   - Submit a new trade entry
   - Feedback is generated automatically
   - Check the trade details in the Journal section

