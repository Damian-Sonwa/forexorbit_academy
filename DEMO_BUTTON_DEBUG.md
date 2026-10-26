# Demo Button Visibility - Debugging Guide

## Why the Button Might Not Be Visible

The demo button appears when ALL of these conditions are met:

1. ✅ **Feature is enabled**: `DEMO_UNLOCK_ENABLED = true` in `lib/demo-unlock-config.ts`
2. ✅ **User is a student**: `user.role === 'student'`
3. ✅ **User is NOT enrolled**: `course.enrolled === false`
4. ✅ **Course data is loaded**: `course` is not `null` or `undefined`
5. ✅ **Lesson is locked**: `isLocked === true`

## How to Test

### Option 1: Use Test Mode (Easiest)

1. Open `lib/demo-unlock-config.ts`
2. Set `DEMO_UNLOCK_TEST_MODE = true`
3. Save and refresh the page
4. The button should appear for ALL students (even if enrolled)

### Option 2: Test with Real Scenario

1. **Log in as a student account**
2. **Navigate to a course you haven't enrolled in**
3. **Click on any lesson**
4. **Check browser console** for debug logs:
   ```
   [Demo Unlock] Access check: {
     lessonId: "...",
     isLocked: true/false/undefined,
     hasAccess: true/false,
     userRole: "student",
     ...
   }
   ```

## Debugging Steps

### Step 1: Check Console Logs

Open browser DevTools (F12) → Console tab

Look for logs starting with `[Demo Unlock]`:
- `Access check:` - Shows the current state
- `Button clicked` - Confirms button was clicked

### Step 2: Check if Course is Loading

If `isLocked: undefined` in console, the course data is still loading. Wait a moment and check again.

### Step 3: Check Enrollment Status

In console, check:
- `course.enrolled` - Should be `false` for button to show
- If `true`, you're enrolled and button won't show

### Step 4: Verify User Role

In console, check:
- `userRole: "student"` - Must be "student" for button to show
- If "instructor" or "admin", button won't show

## Common Issues

### Issue: Button doesn't appear
**Possible causes:**
- User is enrolled in the course → Unenroll to test
- User is not a student → Use student account
- Course data not loaded → Wait for page to fully load
- Feature disabled → Check `DEMO_UNLOCK_ENABLED = true`

### Issue: Button appears but doesn't work
**Check:**
- Browser console for errors
- Click handler logs: `[Demo Unlock] Button clicked`
- Modal should open after click

### Issue: Button appears for enrolled users
**This shouldn't happen** - Check:
- `DEMO_UNLOCK_TEST_MODE` might be enabled
- Course enrollment status might be incorrect

## Quick Test Commands

In browser console, run:

```javascript
// Check demo access status
localStorage.getItem('forexorbit_demo_access')

// Check if feature is enabled (requires page reload after change)
// Check lib/demo-unlock-config.ts file
```

## Force Button to Show (Test Mode)

1. Edit `lib/demo-unlock-config.ts`:
   ```typescript
   export const DEMO_UNLOCK_TEST_MODE = true; // Force show for testing
   ```

2. Save and refresh page

3. Button will show for all students (even if enrolled)

4. **Remember to set back to `false` after testing!**

## Expected Behavior

### When Button Should Show:
- ✅ Student account
- ✅ Not enrolled in course
- ✅ Feature enabled
- ✅ Course data loaded

### When Button Should NOT Show:
- ❌ User is enrolled
- ❌ User is instructor/admin
- ❌ Feature disabled
- ❌ Course data still loading
- ❌ User has demo access (already unlocked)

## Location on Screen

The button appears in the **main lesson content area**, replacing:
- Video player
- Lesson description
- Resources
- Quiz

It's a centered white card with:
- Lock icon (🔒)
- "Lesson Locked" heading
- Description text
- **"Unlock with Demo" button** ← This is what you're looking for

## Still Not Working?

1. Check browser console for errors
2. Verify all conditions above are met
3. Try test mode: `DEMO_UNLOCK_TEST_MODE = true`
4. Check network tab for API errors
5. Verify course enrollment status in database



