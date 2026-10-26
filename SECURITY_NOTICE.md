# ⚠️ Security Notice - Remove Credentials from Git History

## If You've Committed Secrets to Git

If you've accidentally committed environment variables or secrets to your Git repository, you need to remove them from the Git history.

### Option 1: Rotate All Credentials (Recommended)

**The safest approach is to rotate (change) all exposed credentials:**

1. **MongoDB:**
   - Go to MongoDB Atlas → Database Access
   - Create a new database user
   - Update password
   - Update `MONGO_URI` in all environments

2. **JWT Secret:**
   - Generate a new JWT secret
   - Update `JWT_SECRET` in all environments
   - All existing sessions will be invalidated (users will need to log in again)

3. **OANDA API Key:**
   - Go to OANDA account → API Settings
   - Revoke the exposed API key
   - Generate a new API key
   - Update `OANDA_API_KEY` in all environments

4. **Agora Certificate:**
   - Go to Agora Console
   - Regenerate App Certificate
   - Update `AGORA_APP_CERTIFICATE` in all environments

### Option 2: Remove from Git History (Advanced)

**⚠️ WARNING: This rewrites Git history. Only do this if you understand the consequences.**

If you must remove files from Git history:

```bash
# Remove .env file from all commits
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch .env .env.local" \
  --prune-empty --tag-name-filter cat -- --all

# Force push (DANGEROUS - coordinate with team)
git push origin --force --all
```

**Better alternative using git-filter-repo:**
```bash
# Install git-filter-repo first
pip install git-filter-repo

# Remove .env files from history
git filter-repo --path .env --path .env.local --invert-paths

# Force push
git push origin --force --all
```

### Option 3: Use BFG Repo-Cleaner

```bash
# Download BFG Repo-Cleaner
# Remove .env files
java -jar bfg.jar --delete-files .env
java -jar bfg.jar --delete-files .env.local

# Clean up
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Force push
git push origin --force --all
```

## Current Status

✅ **Good News:** 
- No `.env` or `.env.local` files are currently tracked in Git
- `.gitignore` has been updated to exclude all environment files
- Hardcoded credentials have been removed from README.md

## Prevention

To prevent future issues:

1. ✅ `.gitignore` now excludes all `.env*` files
2. ✅ Use `.env.example` as a template (no real values)
3. ✅ Never commit actual credentials
4. ✅ Use environment variables in Vercel/Render dashboards
5. ✅ Review files before committing: `git status` and `git diff`

## Verification

Check if any secrets are in your repository:

```bash
# Check for .env files
git ls-files | grep -E "\.env"

# Search for potential secrets (be careful with this)
git log -p -S "mongodb+srv://" --all
git log -p -S "JWT_SECRET" --all
```

## Next Steps

1. ✅ Rotate all credentials that may have been exposed
2. ✅ Update environment variables in Vercel and Render
3. ✅ Verify `.gitignore` is working: Try `git add .env.local` (should be ignored)
4. ✅ Set up environment variables in deployment platforms
5. ✅ Test the application with new credentials

