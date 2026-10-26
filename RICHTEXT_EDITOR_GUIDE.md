# Rich Text Editor for Lesson Content - Implementation Guide

## Overview

This document describes the implementation of a Word-like rich text editor (TinyMCE) for instructors and admins to create and edit lesson content with advanced formatting options.

## Key Features

### For Instructors/Admins Only
- WYSIWYG rich text editor with Word-like formatting toolbar
- Full control over lesson content formatting
- Autosave every 30 seconds
- Real-time HTML serialization
- Only visible to `INSTRUCTOR` and `ADMIN` roles

### For Students (Read-Only)
- Rendered lesson content as sanitized HTML
- No editor visible
- No edit buttons or controls
- Safe content rendering with XSS protection

## Architecture

### Components

#### 1. **InstructorLessonEditor** (`components/InstructorLessonEditor.tsx`)
- React component with TinyMCE integration
- Manages lesson content editing and saving
- Implements autosave functionality
- Displays save status feedback
- Props:
  ```typescript
  interface InstructorLessonEditorProps {
    lessonId: string;           // Lesson ID to edit
    courseId: string;           // Course ID for reference
    initialContent?: string;    // Initial HTML content
    onSave?: () => void;       // Callback when saved
  }
  ```

#### 2. **Lesson Display** (`pages/courses/[id]/lessons/[lessonId].tsx`)
- Integrated editor for instructors
- Sanitized content rendering for students
- Role-based visibility (editor only for instructors)
- Socket.io real-time updates on content change

### Backend

#### API Endpoint: `PUT /api/lessons/[id]`
- Existing endpoint updated to handle `content` field
- Role-based access control (instructor/admin only)
- Data validation and storage
- No changes to existing lesson schema

**Request Body:**
```json
{
  "content": "<p>Rich HTML content here</p>",
  "other_fields": "..."
}
```

### Security

#### HTML Sanitization (`lib/html-sanitizer.ts`)
- Utility functions for cleaning HTML content
- Whitelists safe tags: `p`, `br`, `strong`, `b`, `em`, `i`, `u`, `h1-h6`, `ul`, `ol`, `li`, `a`, `img`, `table`, `code`, `pre`, etc.
- Removes dangerous attributes (event handlers, javascript: URLs)
- Blocks XSS attacks while preserving formatting

**Sanitization Flow:**
1. Instructor saves content from editor
2. Backend stores raw HTML in database
3. When displaying to students, content is sanitized before rendering
4. Safe HTML is rendered with `dangerouslySetInnerHTML`

## Implementation Details

### Role-Based Access Control

```typescript
// Only instructors can see the editor
if (user?.role === 'instructor') {
  // Show editor button and component
}

// Instructors also used admin role are both supported
if (['instructor', 'admin', 'superadmin'].includes(user?.role)) {
  // Full access
}
```

### Autosave Mechanism

- **Interval:** 30 seconds
- **Trigger:** Content changes
- **Silent Save:** No user interaction required
- **Status Indicator:** Shows saving/saved/error state
- **User-Initiated Save:** Manual "Save" button available

**Implementation:**
```typescript
useEffect(() => {
  const timer = setInterval(() => {
    if (content !== lastSavedContent) {
      handleAutosave(); // Silent save
    }
  }, 30000); // 30 seconds
  
  return () => clearInterval(timer);
}, [content]);
```

### TinyMCE Configuration

**Toolbar:**
```
undo redo | formatselect | bold italic underline strikethrough | 
forecolor backcolor | alignleft aligncenter alignright alignjustify | 
bullist numlist outdent indent | removeformat | 
link image media table codesample | fullscreen preview code help
```

**Plugins:**
- `advlist` - Advanced lists
- `autolink` - Auto-link detection
- `lists` - Bullet and numbered lists
- `link` - Link insertion
- `image` - Image insertion
- `table` - Table creation
- `code` - Code view and editing
- `codesample` - Code block formatting
- `media` - Media embedding
- `fullscreen` - Full-screen mode
- `preview` - Content preview
- `wordcount` - Word counting

## Usage Flow

### For Instructors

1. **Navigate to Lesson**
   - Go to lesson page for a course they teach

2. **Edit Content**
   - Click "Edit Content" button (amber/orange colored)
   - Editor panel expands below video player

3. **Format Content**
   - Use toolbar for formatting (bold, headings, lists, etc.)
   - Insert links, images, tables, code blocks
   - Preview changes in real-time

4. **Save**
   - Manual save: Click "Save Lesson Content" button
   - Automatic save: Every 30 seconds (shows "Saving..." indicator)

5. **Verify**
   - Click "Hide Editor" to close
   - Page refreshes to show updated content
   - Students immediately see the new formatted content

### For Students

1. **View Lesson**
   - No editor visible
   - Lesson description shows rendered HTML content
   - Content is already sanitized and safe

2. **No Edit Access**
   - No edit buttons
   - No contenteditable elements
   - Read-only view only

## Database Schema

### Lessons Collection

The `content` field already exists in the lessons collection:

```javascript
{
  _id: ObjectId,
  courseId: String,
  title: String,
  description: String,
  content: String,        // ← Rich HTML content (NEW usage)
  summary: String,        // ← Old text overview (kept for compatibility)
  lessonSummary: {
    overview: String,     // ← Text summary
    screenshots: Array,
    resources: Array
  },
  videoUrl: String,
  pdfUrl: String,
  type: String,           // video | pdf | interactive
  order: Number,
  resources: Array,
  createdAt: Date,
  updatedAt: Date
}
```

**Note:** The `content` field was already present for HTML content. We're simply utilizing it with the rich text editor.

## Environment Variables

### Required

```env
# TinyMCE Cloud API Key (get from https://www.tiny.cloud/)
NEXT_PUBLIC_TINYMCE_API_KEY=your_api_key_here
```

**IMPORTANT:** 
- This is a public key (NEXT_PUBLIC prefix) - it's safe to expose
- Get free API key from: https://www.tiny.cloud/
- API keys are limited by domain in TinyMCE Cloud

### Optional
- No additional required variables

## Installation

### 1. Install Dependencies

```bash
npm install @tinymce/tinymce-react tinymce
```

### 2. Set Environment Variable

Add to `.env.local`:
```env
NEXT_PUBLIC_TINYMCE_API_KEY=your_tinymce_api_key
```

### 3. Restart Dev Server

```bash
npm run dev
```

## Testing

### Manual Testing Checklist

- [ ] Instructor can see "Edit Content" button
- [ ] Admin can see "Edit Content" button  
- [ ] Student cannot see "Edit Content" button
- [ ] Editor opens when clicking button
- [ ] Editor toolbar displays all formatting options
- [ ] Can type and format text (bold, italic, etc.)
- [ ] Can insert links, images, tables
- [ ] Content autosaves every 30 seconds
- [ ] Manual save works
- [ ] Page refreshes show updated content
- [ ] Student view shows rendered HTML
- [ ] HTML is sanitized (no script tags visible)

### Role Testing

```typescript
// Test cases
if (user.role === 'STUDENT') {
  // ✓ Editor hidden
  // ✓ Only see rendered content
  // ✓ No edit buttons
}

if (user.role === 'INSTRUCTOR') {
  // ✓ Editor visible
  // ✓ Can save content
  // ✓ Autosave works
}

if (user.role === 'ADMIN') {
  // ✓ Editor visible
  // ✓ Can save content
  // ✓ Full access
}
```

## Files Modified

### New Files Created
1. `components/InstructorLessonEditor.tsx` - Rich text editor component
2. `lib/html-sanitizer.ts` - HTML sanitization utility

### Files Updated
1. `pages/courses/[id]/lessons/[lessonId].tsx` - Integrated editor and sanitization
2. `ENV_SETUP_GUIDE.md` - Added TinyMCE setup instructions

### Files NOT Modified (Preserved)
- All existing lesson APIs
- Authentication/authorization logic
- Student dashboard functionality
- Existing content display logic
- Database schema

## API Integration

### Saving Content

```typescript
// Editor saves via existing API
await apiClient.put(`/lessons/${lessonId}`, {
  content: '<p>Formatted HTML content</p>'
});

// Backend validates role-based access
if (req.user.role !== 'instructor' && req.user.role !== 'admin') {
  return res.status(403).json({ error: 'Not authorized' });
}
```

### Getting Content

```typescript
// Existing lesson fetch
const lesson = await apiClient.get(`/lessons/${lessonId}`);
// Returns: { content: '<p>HTML content</p>', ... }

// Display to students with sanitization
<div dangerouslySetInnerHTML={{ 
  __html: sanitizeHtml(lesson.content) 
}} />
```

## Performance Considerations

### Autosave Optimization
- Only saves if content has actually changed
- 30-second interval prevents excessive requests
- Silently fails and shows error state
- Doesn't block user interaction

### HTML Rendering
- Sanitization happens on client-side for SSR compatibility
- Large HTML documents render efficiently with Tailwind CSS prose
- No performance impact for students reading content

## Troubleshooting

### Editor doesn't load
1. Check browser console for errors
2. Verify `NEXT_PUBLIC_TINYMCE_API_KEY` is set
3. Ensure API key is valid
4. Hard refresh browser (Ctrl+Shift+R)

### Content not saving
1. Check network tab for failed requests
2. Verify user has instructor role
3. Check API endpoint is working
4. Review server logs for error messages

### HTML not rendering correctly
1. Check sanitizer whitelist for removed tags
2. Verify HTML is valid (use browser dev tools)
3. Check browser console for errors
4. Ensure content was actually saved to database

### Autosave not working
1. Verify content has actually changed
2. Check browser network tab
3. Look for error messages in console
4. Verify API endpoint authentication

## Future Enhancements

- [ ] Collaboration/real-time co-editing
- [ ] Version history and rollback
- [ ] Drag-and-drop image upload
- [ ] Template system for common content
- [ ] Media gallery integration
- [ ] Search and replace functionality
- [ ] Content preview for students before publishing
- [ ] A/B testing different lesson formats

## Compliance & Standards

- ✅ XSS Attack Prevention (HTML sanitization)
- ✅ CSRF Protection (existing Next.js/auth middleware)
- ✅ Role-Based Access Control (existing authorization)
- ✅ GDPR Compliance (no tracking added)
- ✅ Accessibility (TinyMCE has ARIA support)

## Support

For questions or issues:
1. Check the `ENV_SETUP_GUIDE.md` for configuration
2. Review TinyMCE documentation: https://www.tiny.cloud/docs/
3. Check browser console for error messages
4. Review server logs for backend issues
