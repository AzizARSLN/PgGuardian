@echo off
REM =====================================================================
REM  PgGuardian - Backend (FastAPI) Starter
REM  - Docker kullanmadan sadece backend API baslatir
REM  - PostgreSQL baglantisi .env dosyasindan okunur
REM =====================================================================

setlocal
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

REM ---------- Python secimi (.venv oncelikli) ----------
set "PYTHON_EXE="
set "VENV_PY=%SCRIPT_DIR%.venv\Scripts\python.exe"

if exist "%VENV_PY%" (
    set "PYTHON_EXE=%VENV_PY%"
    goto :python_found
)

py -3 --version >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_EXE=py -3"
    goto :python_found
)

for /f "usebackq delims=" %%P in (`where python 2^>nul`) do (
    if not defined PYTHON_EXE set "PYTHON_EXE=%%P"
)

:python_found
if not defined PYTHON_EXE (
    echo.
    echo [ERROR] Python bulunamadi.
    echo         Python 3.11+ kur veya su komutuyla venv olustur:
    echo         py -3 -m venv .venv ^&^& .venv\Scripts\activate ^&^& pip install -e .[dev]
    echo.
    pause
    exit /b 1
)

REM ---------- PYTHONPATH ----------
set "PYTHONPATH=%SCRIPT_DIR%src"

echo.
echo ============================================================================
echo    PgGuardian BACKEND (FastAPI)
echo ----------------------------------------------------------------------------
echo    Python   : %PYTHON_EXE%
echo    Source   : %PYTHONPATH%
echo    API      : http://127.0.0.1:8000
echo    Docs     : http://127.0.0.1:8000/docs
echo    Scalar   : http://127.0.0.1:8000/reference
echo    Health   : http://127.0.0.1:8000/api/v1/health
echo ============================================================================
echo.

REM ---------- Bagimlilik kontrolu ----------
%PYTHON_EXE% -c "from pgguardian.api.app import create_app; create_app()" >nul 2>&1
if errorlevel 1 (
    echo [!] PgGuardian paketi eksik veya bozuk - duzeltiliyor ...
    %PYTHON_EXE% -m pip install -e ".[dev]"
    if errorlevel 1 (
        echo [ERROR] Editable install basarisiz.
        pause
        exit /b 1
    )
)

echo Baslatiliyor... Durdurmak icin Ctrl+C
echo.
echo ----------------------------------------------------------------------------

%PYTHON_EXE% -m uvicorn pgguardian.api.app:app ^
    --host 127.0.0.1 ^
    --port 8000 ^
    --reload ^
    --reload-dir "%SCRIPT_DIR%src\pgguardian" ^
    --reload-include *.py ^
    --reload-include *.sql ^
    --log-level info

echo.
echo PgGuardian backend durduruldu.
pause
endlocal
exit /b 0
