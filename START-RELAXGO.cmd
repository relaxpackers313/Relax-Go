@echo off
rem ── Relax Go dev stack ────────────────────────────────────────────────────────
rem Double-click this file to start everything. Each service opens in its own
rem window; close a window to stop that service.
cd /d "%~dp0"

echo Starting Relax Go API (:4100)...
start "RelaxGo API" cmd /k "pnpm --filter @relaxgo/api dev"

echo Starting Relax Go Admin panel (:3100)...
start "RelaxGo Admin" cmd /k "pnpm --filter @relaxgo/admin dev"

echo.
echo ================================================================
echo   Admin panel : http://localhost:3100
echo   API health  : http://localhost:4100/health
echo.
echo   For the PHONE (USB debugging on, cable connected):
echo     1. In a new terminal:  cd apps\customer   (or apps\driver)
echo     2.                     npx expo start --dev-client --port 8081
echo     3. In another:         D:\Android\Sdk\platform-tools\adb reverse tcp:4100 tcp:4100
echo                            D:\Android\Sdk\platform-tools\adb reverse tcp:8081 tcp:8081
echo     4. Open the app on the phone.
echo ================================================================
pause
