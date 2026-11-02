@echo off
REM =====================================================================
REM  PgGuardian - Frontend (Next.js) Starter
REM  - Docker kullanmadan sadece frontend UI baslatir
REM  - pnpm varsa pnpm dev, yoksa npm run dev kullanir
REM  NOT1: npm/pnpm/corepack .cmd dosyalaridir, bu yuzden "call" ile cagrilir.
REM  NOT2: Parantezli if bloklari icindeki echo satirlarinda parantez kullanma.
REM =====================================================================

setlocal
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

set "UI_PORT=3000"
set "FRONTEND_DIR=%SCRIPT_DIR%frontend"

if not exist "%FRONTEND_DIR%\package.json" (
    echo [ERROR] frontend/package.json bulunamadi. Dizin: %FRONTEND_DIR%
    pause
    exit /b 1
)

REM ---------- Paket yoneticisi secimi: pnpm oncelikli, npm fallback ----------
set "PKG_MGR="
set "DEV_CMD="

call pnpm --version >nul 2>&1
if not errorlevel 1 (
    set "PKG_MGR=pnpm"
    set "DEV_CMD=pnpm dev"
    goto :pkg_found
)

REM corepack ile pnpm etkinlestirmeyi dene
where corepack >nul 2>&1
if not errorlevel 1 (
    call corepack enable >nul 2>&1
    call corepack prepare pnpm@10.17.1 --activate >nul 2>&1
    call pnpm --version >nul 2>&1
    if not errorlevel 1 (
        set "PKG_MGR=pnpm"
        set "DEV_CMD=pnpm dev"
        goto :pkg_found
    )
)

REM Fallback: npm
call npm --version >nul 2>&1
if not errorlevel 1 (
    set "PKG_MGR=npm"
    set "DEV_CMD=npm run dev"
    goto :pkg_found
)

:pkg_found
if not defined PKG_MGR (
    echo [ERROR] Ne pnpm ne npm bulunamadi. Node.js LTS kur: https://nodejs.org/
    pause
    exit /b 1
)

echo.
echo ============================================================================
echo    PgGuardian FRONTEND - Next.js
echo ----------------------------------------------------------------------------
echo    Package manager : %PKG_MGR%
echo    Directory       : %FRONTEND_DIR%
echo    UI              : http://localhost:%UI_PORT%
echo ============================================================================
echo.

REM ---------- node_modules yoksa kur ----------
if not exist "%FRONTEND_DIR%\node_modules" (
    echo [!] node_modules bulunamadi - bagimliliklar kuruluyor ...
    pushd "%FRONTEND_DIR%"
    if "%PKG_MGR%"=="pnpm" (
        call pnpm install
    ) else (
        call npm install --no-audit --no-fund
    )
    if errorlevel 1 (
        echo [WARN] install basarisiz, yine de devam ediliyor ...
    )
    popd
)

echo Baslatiliyor... Durdurmak icin Ctrl+C
echo.
echo ----------------------------------------------------------------------------

cd /d "%FRONTEND_DIR%"
call %DEV_CMD%

echo.
echo PgGuardian frontend durduruldu.
pause
endlocal
exit /b 0