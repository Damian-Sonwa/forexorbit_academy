@echo off
setlocal
title ForexOrbit Academy - local preview
rem One-click local preview. Runs the development server only ("npm run dev" = node server.js).
rem It never builds, deploys, seeds, migrates or starts a payment. Each check stops before
rem anything runs and prints only setting names, never their values.

cd /d "%~dp0"
echo.
echo  ForexOrbit Academy - local preview
echo  Folder: %CD%
echo.

rem --- 1. Project files and Node.js -------------------------------------------------------
if not exist "package.json" goto :no_project
if not exist "server.js" goto :no_project
where node >nul 2>nul
if errorlevel 1 goto :no_node

rem --- 2. Git branch (read only) -----------------------------------------------------------
where git >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%B in ('git branch --show-current 2^>nul') do echo  Git branch: %%B
  for /f %%C in ('git status --short 2^>nul ^| find /c /v ""') do echo  Uncommitted files: %%C
)

rem --- 3. Free disk space ------------------------------------------------------------------
set "FREE_GB="
for /f %%G in ('powershell -NoProfile -Command "[math]::Floor((Get-Item -LiteralPath (Get-Location).Path).PSDrive.Free/1GB)" 2^>nul') do set "FREE_GB=%%G"
if defined FREE_GB (
  echo  Free disk space on this drive: %FREE_GB% GB
  if %FREE_GB% LSS 2 goto :low_disk
)

rem --- 4. Dependencies ---------------------------------------------------------------------
if not exist "node_modules\next\package.json" goto :no_deps
if not exist "node_modules\dotenv\package.json" goto :no_deps

rem --- 5. Local settings (names only; see the check at the end of this file) ----------------
echo.
echo  Checking local settings:
node -e "const s=require('fs').readFileSync(process.argv[1],'utf8');eval(s.slice(s.lastIndexOf('::ENV'+'CHECK')+10))" "%~f0"
if errorlevel 1 goto :bad_env

rem --- 6. Port 3000 ------------------------------------------------------------------------
set "PORT_PID="
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /R /C:":3000 .*LISTENING"') do set "PORT_PID=%%P"
if not defined PORT_PID (
  for /f "tokens=5" %%P in ('netstat -ano -p tcpv6 ^| findstr /R /C:":3000 .*LISTENING"') do set "PORT_PID=%%P"
)
if defined PORT_PID goto :port_busy

rem --- 7. Open the browser once the server accepts connections, then run it here ----------
echo.
echo  Starting the development server. The first page can take a minute to compile.
echo  Your browser opens automatically when the server is ready.
echo  To stop the server: press Ctrl+C in this window.
echo.
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -Command "$end=(Get-Date).AddMinutes(5); while((Get-Date) -lt $end){ try { $c=New-Object Net.Sockets.TcpClient('localhost',3000); $c.Close(); Write-Host ''; Write-Host '  >> Server is ready. Opening http://localhost:3000'; Write-Host ''; Start-Process 'http://localhost:3000'; exit } catch { Start-Sleep -Seconds 2 } }; Write-Host '  >> The server did not start within 5 minutes. Read the messages above.'"
call npm run dev
echo.
echo  The server has stopped. Any error is shown above.
goto :end

:no_project
echo  [X] This file must sit in the ForexOrbit project folder, next to package.json and server.js.
goto :end

:no_node
echo  [X] Node.js was not found. Install the Node.js LTS release from https://nodejs.org, then try again.
goto :end

:low_disk
echo.
echo  [X] Less than 2 GB is free on this drive. The server and its build cache need more room,
echo      and a full disk causes ENOSPC errors. Free up space first, for example by emptying the
echo      Recycle Bin or removing old review folders you no longer need, then try again.
goto :end

:no_deps
echo.
echo  [X] Dependencies are not installed in this folder (the "next" package is missing).
echo      They need about 1 GB. With at least 3 GB free, open a terminal in this folder and run:
echo.
echo          npm ci --ignore-scripts
echo.
echo      Then double-click this file again.
goto :end

:bad_env
echo.
echo  [X] Fix the settings marked [X] above in your local .env.local file, then try again.
echo      Use only your development database and Paystack TEST keys. Never production values.
goto :end

:port_busy
echo.
echo  [!] Port 3000 is already in use by process %PORT_PID%:
tasklist /FI "PID eq %PORT_PID%" /NH
echo.
echo      If that is ForexOrbit already running, just open http://localhost:3000 in your browser.
echo      Otherwise close that program, or the other terminal window running the server
echo      by pressing Ctrl+C there, then double-click this file again.
echo      This launcher does not start a second copy.
goto :end

:end
echo.
pause
endlocal
goto :eof

rem The script below is read by Node in step 5; cmd never runs past the line above.
::ENVCHECK
// Settings are merged the way server.js and Next.js load them: the shell first, then the
// file server.js loads, then Next's development files. Only names and verdicts are printed.
const fs = require('fs');
const dotenv = require('dotenv');
const primary = fs.existsSync('.env.local') ? '.env.local' : '.env';
const files = [...new Set([primary, '.env.development.local', '.env.local', '.env.development', '.env'])].filter((f) => fs.existsSync(f));
const parsed = files.map((f) => dotenv.parse(fs.readFileSync(f)));
const value = (name) => {
  if (process.env[name] !== undefined) return String(process.env[name]).trim();
  for (const p of parsed) if (p[name] !== undefined) return String(p[name]).trim();
  return '';
};
let failed = false;
const ok = (m) => console.log('  [OK] ' + m);
const info = (m) => console.log('  [--] ' + m);
const bad = (m) => { console.log('  [X]  ' + m); failed = true; };

if (!files.length) bad('No .env.local or .env file in this folder. Copy your DEVELOPMENT settings file here.');
else info('Settings files found: ' + files.join(', '));

const uri = value('MONGO_URI') || value('MONGODB_URI');
if (!uri) bad('MONGO_URI (or MONGODB_URI) is missing');
else if (!/^mongodb(\+srv)?:\/\//.test(uri)) bad('MONGO_URI does not start with mongodb:// or mongodb+srv://');
else ok('MONGO_URI is set');

if (value('JWT_SECRET')) ok('JWT_SECRET is set');
else bad('JWT_SECRET is missing');

const db = value('MONGODB_DB_NAME');
if (/_(dev|test)$/i.test(db)) ok('MONGODB_DB_NAME points to a development database');
else if (!db) bad('MONGODB_DB_NAME is missing. Without it the app uses the shared production database. Set it to your development database name.');
else bad('MONGODB_DB_NAME must be a development database whose name ends in _dev or _test');

if (value('NODE_ENV') === 'production') bad('NODE_ENV is set to production. Remove it for a local preview.');
else ok('NODE_ENV is not production');

const port = value('PORT');
if (port && port !== '3000') bad('PORT is set to another port. Remove it so the app uses 3000.');

const sk = value('PAYSTACK_SECRET_KEY');
if (!sk) info('PAYSTACK_SECRET_KEY is not set: checkout will say payments are unavailable');
else if (sk.startsWith('sk_test_')) ok('PAYSTACK_SECRET_KEY is a test key');
else bad('PAYSTACK_SECRET_KEY is not a test key (sk_test_...). Never use live keys locally.');

const pk = value('NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY');
if (!pk) info('NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY is not set: the Unlock button cannot open Paystack');
else if (pk.startsWith('pk_test_')) ok('NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY is a test key');
else bad('NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY is not a test key (pk_test_...). Never use live keys locally.');

process.exit(failed ? 1 : 0);
