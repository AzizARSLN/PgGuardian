@echo off
REM =====================================================================
REM  PgGuardian - Start All Services (Windows Batch)
REM  - Uses .venv if found (FIRST PRIORITY - prevents RuntimeError)
REM  - Starts Docker PostgreSQL (password=1), waits for pg_isready
REM  - Checks python-multipart (fixes "Form data requires..." error)
REM  - Launches PgGuardian API (debug reload mode)
REM  - Launches Next.js Frontend (separate window, pnpm dev)
REM =====================================================================

setlocal
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

REM ---------- Ensure trailing backslash removed for consistent concat ----------
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "PG_PORT=5432"
set "API_HOST=127.0.0.1"
set "API_PORT=8000"
set "UI_PORT=3000"
set "WAIT_POSTGRES_MAX_SEC=60"

REM =====================================================================
REM  STEP 0 : Pick Python ( 1) .venv   2) py launcher   3) where python)
REM =====================================================================
set "PYTHON_EXE="
set "USING_VENV=0"
set "VENV_PY=%SCRIPT_DIR%\.venv\Scripts\python.exe"
set "VENV_PIP=%SCRIPT_DIR%\.venv\Scripts\pip.exe"

if exist "%VENV_PY%" (
    set "PYTHON_EXE=%VENV_PY%"
    set "PIP_EXE=%VENV_PIP%"
    set "USING_VENV=1"
    goto :python_found
)

REM Try "py -3" launcher (official Python installer default)
py -3 --version >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_EXE=py -3"
    set "PIP_EXE=py -3 -m pip"
    goto :python_found
)

REM Finally: where python
for /f "usebackq delims=" %%P in (`where python 2^>nul`) do (
    if not defined PYTHON_EXE (
        set "PYTHON_EXE=%%P"
        set "PIP_EXE=%%~dpP..\Scripts\pip.exe"
    )
)

:python_found
if not defined PYTHON_EXE (
    echo.
    echo [ERROR] Python not found.
    echo         Install Python 3.11+ or create a local venv:
    echo         py -3 -m venv .venv ^&^& .venv\Scripts\activate ^&^& pip install -e .[dev]
    echo.
    pause
    exit /b 1
)

REM ---------- PYTHONPATH: ensure uvicorn child processes can see src/ ----------
set "PYTHONPATH=%SCRIPT_DIR%\src"

REM =====================================================================
REM  BANNER (ASCII only, no UTF-8, no parens inside echo - no surprises)
REM =====================================================================
echo.
echo ============================================================================
echo    PPPP    GGG   GGG  U   U  AAAAA  RRRR   DDDD    III   AAAAA  N   N
echo    P   P  G      G     U   U  A   A  R   R  D   D    I    A   A  NN  N
echo    PPPP   G  GG  G  GG U   U  AAAAA  RRRR   D   D    I    AAAAA  N N N
echo    P      G   G  G   G U   U  A   A  R  R   D   D    I    A   A  N  NN
echo    P       GGG    GGG   UUU   A   A  R   R  DDDD    III   A   A  N   N
echo ============================================================================
echo    PgGuardian ALL-IN-ONE STARTER
echo ----------------------------------------------------------------------------
echo    PostgreSQL Password : 1
if %USING_VENV%==1 echo    VirtualEnv          : YES .venv ^(recommended^)
if %USING_VENV%==0 echo    VirtualEnv          : NO ^(using system python^)
echo    Debug Mode          : ENABLED ^(auto-reload + verbose logging^)
echo ============================================================================
echo    Python   : %PYTHON_EXE%
echo    Source   : %PYTHONPATH%
echo    Frontend (Next.js) : http://%API_HOST%:%UI_PORT%
echo ============================================================================
echo.

REM =====================================================================
REM  STEP 1 : Docker Desktop running?
REM =====================================================================
echo [1/6] Checking Docker ...
docker version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker not found or Docker Desktop not running.
    echo         Install / start Docker Desktop: https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)
echo        Docker OK.
echo.

REM =====================================================================
REM  STEP 2 : Start PostgreSQL container (detached)
REM =====================================================================
echo [2/6] Starting PostgreSQL container ^(docker compose up -d postgres^) ...
docker compose up -d postgres
if errorlevel 1 (
    REM Older Docker may use hyphenated docker-compose
    echo        "docker compose" failed, trying "docker-compose" ...
    docker-compose up -d postgres
    if errorlevel 1 (
        echo [ERROR] Could not start PostgreSQL container.
        pause
        exit /b 1
    )
)
echo        Container start command sent.
echo.

REM =====================================================================
REM  STEP 3 : Wait until PostgreSQL is actually ready ^(pg_isready^)
REM =====================================================================
echo [3/6] Waiting for PostgreSQL to accept connections ^(max %WAIT_POSTGRES_MAX_SEC%s^) ...
set "ELAPSED=0"
set "PG_READY=0"

:wait_loop
docker compose exec -T postgres pg_isready -U pgguardian -d pgguardian >nul 2>&1
if not errorlevel 1 (
    set "PG_READY=1"
    goto :wait_done
)
if %ELAPSED% GEQ %WAIT_POSTGRES_MAX_SEC% goto :wait_timeout
<nul set /p "=."
timeout /t 2 /nobreak >nul
set /a ELAPSED+=2
goto :wait_loop

:wait_timeout
echo.
echo [WARN] Timeout waiting for PostgreSQL. Continuing anyway ...
goto :wait_done

:wait_done
if %PG_READY%==1 echo  READY.
echo.

REM =====================================================================
REM  STEP 4 : Verify dependencies (esp python-multipart for Form/UploadFile)
REM =====================================================================
echo [4/6] Checking Python dependencies ...

REM Check python-multipart
%PYTHON_EXE% -c "import multipart" >nul 2>&1
if errorlevel 1 (
    echo        python-multipart MISSING - installing now ...
    %PIP_EXE% install python-multipart
    if errorlevel 1 (
        echo [ERROR] Failed to install python-multipart.
        pause
        exit /b 1
    )
)

REM Check that pgguardian imports and create_app runs
%PYTHON_EXE% -c "from pgguardian.api.app import create_app; create_app()" >nul 2>&1
if errorlevel 1 (
    echo        PgGuardian package missing or broken - reinstalling editable ...
    %PIP_EXE% install -e ".[dev]"
    if errorlevel 1 (
        echo [ERROR] Editable install failed. Check the pip output above.
        pause
        exit /b 1
    )
)

REM Final sanity check (prints OK on success)
%PYTHON_EXE% -c "import multipart; from pgguardian.api.app import create_app; create_app(); print('       Dependencies OK.')"
if errorlevel 1 (
    echo [ERROR] Dependency check still failing.
    pause
    exit /b 1
)
echo.

REM =====================================================================
REM  STEP 5 : Quick CLI health-check, print endpoints
REM =====================================================================
echo [5/6] Running quick CLI health check ...
%PYTHON_EXE% -m pgguardian health
REM health exit code 2 means "couldn't connect but CLI works" - non-fatal here
echo.

echo ============================================================================
echo  APPLICATION ENDPOINTS  (open these in your browser after startup)
echo ----------------------------------------------------------------------------
echo    Dashboard (UI)     :  http://%API_HOST%:%UI_PORT%/ ^(Dashboard^)
echo    Scalar Reference   :  http://%API_HOST%:%API_PORT%/reference
echo    Swagger UI         :  http://%API_HOST%:%API_PORT%/docs
echo    Health Endpoint    :  http://%API_HOST%:%API_PORT%/api/v1/health
echo    OpenAPI JSON       :  http://%API_HOST%:%API_PORT%/openapi.json
echo    Service Info       :  http://%API_HOST%:%API_PORT%/
echo ============================================================================
echo.

REM =====================================================================
REM  STEP 6 : Start Next.js Frontend (separate window) + then launch API
REM =====================================================================
echo [6/6] Starting Next.js Frontend ...

REM ============================================================
REM  Pick package manager: 1) pnpm  2) npm  (fallback chain)
REM ============================================================
set "PKG_MGR="
set "INSTALL_CMD="
set "DEV_CMD="

pnpm --version >nul 2>&1
if not errorlevel 1 (
    set "PKG_MGR=pnpm"
    set "INSTALL_CMD=pnpm install"
    set "DEV_CMD=pnpm dev"
    goto pkg_found
)

REM pnpm not found - try corepack enable once, then recheck
where corepack >nul 2>&1
if not errorlevel 1 (
    corepack enable >nul 2>&1
    corepack prepare pnpm@10.17.1 --activate >nul 2>&1
    pnpm --version >nul 2>&1
    if not errorlevel 1 (
        set "PKG_MGR=pnpm"
        set "INSTALL_CMD=pnpm install"
        set "DEV_CMD=pnpm dev"
        goto pkg_found
    )
)

REM Final fallback: npm
npm --version >nul 2>&1
if not errorlevel 1 (
    set "PKG_MGR=npm"
    set "INSTALL_CMD=npm install --no-audit --no-fund"
    set "DEV_CMD=npm run dev"
    goto pkg_found
)

:pkg_found
if not defined PKG_MGR (
    echo [ERROR] Neither pnpm nor npm found. Install Node.js LTS from https://nodejs.org/
    pause
    exit /b 1
)
echo        Package manager    : %PKG_MGR%

REM Install deps if node_modules missing
if not exist "%SCRIPT_DIR%\frontend\node_modules" (
    echo        Running %PKG_MGR% install in frontend ...
    pushd "%SCRIPT_DIR%\frontend"
    %INSTALL_CMD%
    if errorlevel 1 (
        echo [WARN] %PKG_MGR% install failed, continuing anyway ...
    )
    popd
)

echo        Launching PgGuardian Frontend in new window ...
start "PgGuardian Frontend" cmd /k "cd /d %SCRIPT_DIR%\frontend && %DEV_CMD%"

echo.
echo  Starting PgGuardian API with auto-reload and debug logging ...
echo  To STOP: Close this window OR press Ctrl+C
echo.
echo ----------------------------------------------------------------------------

REM =====================================================================
REM  LAUNCH UVICORN DIRECTLY so spawned reload subprocess inherits:
REM    - the SAME .venv python interpreter (fixes multipart RuntimeError)
REM    - the PYTHONPATH env var (fixes "no module named pgguardian" in child)
REM =====================================================================
%PYTHON_EXE% -m uvicorn pgguardian.api.app:app ^
    --host %API_HOST% ^
    --port %API_PORT% ^
    --reload ^
    --reload-dir "%SCRIPT_DIR%\src\PgGuardian" ^
    --reload-include *.py ^
    --reload-include *.sql ^
    --log-level debug ^
    --use-colors

REM If you prefer the CLI banner + output, comment out the block above and
REM uncomment the line below instead:
REM %PYTHON_EXE% -m pgguardian serve --debug --host %API_HOST% --port %API_PORT%

echo.
echo ============================================================================
echo  PgGuardian stopped. PostgreSQL may still be running in Docker.
echo  To shut down everything:   cd /d "%SCRIPT_DIR%"  &&  docker compose down
echo ============================================================================
echo.
pause
endlocal
exit /b 0
