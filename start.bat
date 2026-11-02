@echo off
REM PgGuardian: starts the API and the UI, each in its own window.
REM Close those windows to stop them.

setlocal
cd /d "%~dp0"
set "ROOT=%~dp0"
set "API_PORT=8000"
set "UI_PORT=3000"

REM ---------- Python ----------
set "PY="
if exist "%ROOT%.venv\Scripts\python.exe" set "PY="%ROOT%.venv\Scripts\python.exe""
if defined PY goto :python_ok
py -3 --version >nul 2>&1
if not errorlevel 1 set "PY=py -3"
if defined PY goto :python_ok
echo [HATA] Python bulunamadi. Python 3.11+ kurun.
pause
exit /b 1

:python_ok
set "PYTHONPATH=%ROOT%src"

REM ---------- Python dependencies ----------
%PY% -c "from pgguardian.api.app import create_app; create_app()" >nul 2>&1
if not errorlevel 1 goto :deps_ok
echo Python bagimliliklari kuruluyor...
%PY% -m pip install -e ".[dev]"
if errorlevel 1 goto :deps_failed
:deps_ok

REM ---------- Package manager ----------
set "DEV_CMD="
set "INSTALL_CMD="
call pnpm --version >nul 2>&1
if errorlevel 1 goto :try_npm
set "DEV_CMD=pnpm dev"
set "INSTALL_CMD=pnpm install"
goto :frontend_deps

:try_npm
call npm --version >nul 2>&1
if errorlevel 1 goto :no_node
set "DEV_CMD=npm run dev"
set "INSTALL_CMD=npm install --no-audit --no-fund"

:frontend_deps
if exist "%ROOT%frontend\node_modules" goto :database
echo Frontend bagimliliklari kuruluyor...
pushd "%ROOT%frontend"
call %INSTALL_CMD%
popd

REM ---------- Database (optional: only when Docker is running) ----------
:database
docker version >nul 2>&1
if errorlevel 1 goto :no_docker
echo PostgreSQL konteyneri baslatiliyor...
docker compose up -d postgres
goto :launch

:no_docker
echo [UYARI] Docker calismiyor. Giris icin .env dosyasindaki veritabani acik olmali.

:launch
start "PgGuardian API" /d "%ROOT%" cmd /k %PY% -m uvicorn pgguardian.api.app:app --host 127.0.0.1 --port %API_PORT% --reload --reload-dir src\pgguardian
start "PgGuardian UI" /d "%ROOT%frontend" cmd /k %DEV_CMD%

echo.
echo   UI   : http://localhost:%UI_PORT%
echo   API  : http://127.0.0.1:%API_PORT%/docs
echo.

if defined PGG_NO_BROWSER goto :done
ping -n 8 127.0.0.1 >nul
start "" "http://localhost:%UI_PORT%"

:done
endlocal
exit /b 0

:deps_failed
echo [HATA] Python bagimliliklari kurulamadi.
pause
exit /b 1

:no_node
echo [HATA] Ne pnpm ne npm bulundu. Node.js kurun.
pause
exit /b 1
