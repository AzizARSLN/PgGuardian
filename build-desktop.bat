@echo off
REM =====================================================================
REM  PgGuardian - Desktop (EXE) Builder
REM  - Statik arayuzu derler   (frontend/out)
REM  - Sidecar'i dondurur      (PyInstaller -> src-tauri/binaries)
REM  - Tauri kabugunu paketler (src-tauri/target/release/bundle)
REM  - Derleme bitince cikti klasorunu Explorer'da acar
REM
REM  Kullanim:
REM    build-desktop.bat
REM    build-desktop.bat --skip-frontend     (arayuz zaten derliyse)
REM    build-desktop.bat --skip-sidecar      (sidecar zaten dondurulmussa)
REM    build-desktop.bat --skip-tauri        (sadece sidecar'i uret)
REM
REM  On kosullar: Node.js + npm, Rust toolchain (rustc/cargo),
REM  Visual Studio "C++ ile masaustu gelistirme" (MSVC linker),
REM  Tauri CLI (cargo install tauri-cli) ve .venv icinde pyinstaller.
REM =====================================================================

setlocal
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "OUT_BUNDLE=%SCRIPT_DIR%\src-tauri\target\release\bundle"
set "OUT_RELEASE=%SCRIPT_DIR%\src-tauri\target\release"
set "OUT_EXE=%OUT_RELEASE%\PgGuardian.exe"

REM =====================================================================
REM  STEP 0 : Python secimi (.venv oncelikli)
REM =====================================================================
set "PYTHON_EXE="
set "PIP_EXE="
set "USING_VENV=0"
set "VENV_PY=%SCRIPT_DIR%\.venv\Scripts\python.exe"
set "VENV_PIP=%SCRIPT_DIR%\.venv\Scripts\pip.exe"

if exist "%VENV_PY%" (
    set "PYTHON_EXE=%VENV_PY%"
    set "PIP_EXE=%VENV_PIP%"
    set "USING_VENV=1"
    goto :python_found
)

py -3 --version >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_EXE=py -3"
    set "PIP_EXE=py -3 -m pip"
    goto :python_found
)

for /f "usebackq delims=" %%P in (`where python 2^>nul`) do (
    if not defined PYTHON_EXE (
        set "PYTHON_EXE=%%P"
        set "PIP_EXE=%%~dpP..\Scripts\pip.exe"
    )
)

:python_found
if not defined PYTHON_EXE (
    echo [ERROR] Python bulunamadi. Python 3.11+ kurun veya .venv olusturun.
    pause
    exit /b 1
)

REM ---------- PYTHONPATH: PyInstaller'in src/ altini gormesi icin ----------
set "PYTHONPATH=%SCRIPT_DIR%\src"

echo.
echo ============================================================================
echo    PgGuardian DESKTOP (EXE) BUILDER
echo ----------------------------------------------------------------------------
echo    Python          : %PYTHON_EXE%
if %USING_VENV%==1 echo    VirtualEnv      : YES .venv
if %USING_VENV%==0 echo    VirtualEnv      : NO (system python)
echo    Cikti klasoru   : %OUT_BUNDLE%
echo ============================================================================
echo.

REM =====================================================================
REM  STEP 1 : Node.js + npm
REM =====================================================================
echo [1/7] Node.js / npm kontrol ediliyor ...
where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm bulunamadi. Node.js LTS kurun: https://nodejs.org/
    pause
    exit /b 1
)
echo        npm OK.
echo.

REM =====================================================================
REM  STEP 2 : Rust toolchain (rustc + cargo)
REM =====================================================================
echo [2/7] Rust toolchain kontrol ediliyor ...
where cargo >nul 2>&1
if errorlevel 1 (
    echo [ERROR] cargo bulunamadi. Rust kurun: https://rustup.rs/
    pause
    exit /b 1
)
echo        cargo OK.
echo.

REM =====================================================================
REM  STEP 3 : MSVC linker ortami (Rust link adimi icin LIB/INCLUDE)
REM  Not: Rust MSVC toolchain kendi basina lib yollarini bulamazsa
REM       LNK1104 (msvcrt.lib) hatasi verir; vcvars64 bunu cozer.
REM =====================================================================
echo [3/7] MSVC gelistirici ortami hazirlaniyor ...
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "VS_PATH="
if not exist "%VSWHERE%" goto :msvc_done
for /f "usebackq tokens=*" %%I in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VS_PATH=%%I"
if not defined VS_PATH goto :msvc_done
if not exist "%VS_PATH%\VC\Auxiliary\Build\vcvars64.bat" goto :msvc_done
call "%VS_PATH%\VC\Auxiliary\Build\vcvars64.bat" >nul
:msvc_done
if defined LIB (
    echo        MSVC OK.
) else (
    echo [WARN] MSVC ortami yuklenemedi. Rust link hatalari olabilir.
    echo        Visual Studio "C++ ile masaustu gelistirme" is yuku kurulu olmali.
)
echo.

REM =====================================================================
REM  STEP 4 : Tauri CLI
REM =====================================================================
echo [4/7] Tauri CLI kontrol ediliyor ...
cargo tauri --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Tauri CLI bulunamadi.
    echo         Kurmak icin:  cargo install tauri-cli
    pause
    exit /b 1
)
echo        Tauri CLI OK.
echo.

REM =====================================================================
REM  STEP 5 : PyInstaller (desktop extras)
REM =====================================================================
echo [5/7] PyInstaller kontrol ediliyor ...
%PYTHON_EXE% -m PyInstaller --version >nul 2>&1
if errorlevel 1 (
    echo        PyInstaller eksik - kuruluyor ^(pip install -e ".[desktop]"^) ...
    %PIP_EXE% install -e ".[desktop]"
    if errorlevel 1 (
        echo [ERROR] PyInstaller kurulumu basarisiz.
        pause
        exit /b 1
    )
)
echo        PyInstaller OK.
echo.

REM =====================================================================
REM  STEP 6 : Frontend bagimliliklari (node_modules)
REM =====================================================================
echo [6/7] Frontend bagimliliklari kontrol ediliyor ...
if not exist "%SCRIPT_DIR%\frontend\node_modules" (
    echo        node_modules yok - npm install calistiriliyor ...
    pushd "%SCRIPT_DIR%\frontend"
    npm install --no-audit --no-fund
    if errorlevel 1 (
        popd
        echo [ERROR] npm install basarisiz.
        pause
        exit /b 1
    )
    popd
)
echo        Frontend hazir.
echo.

REM =====================================================================
REM  STEP 7 : Derleme (arayuz -> sidecar -> tauri paketleme)
REM =====================================================================
echo [7/7] Derleme basliyor - bu islem uzun surebilir ...
echo ----------------------------------------------------------------------------
%PYTHON_EXE% "%SCRIPT_DIR%\packaging\build_desktop.py" %*
if errorlevel 1 (
    echo.
    echo [ERROR] Derleme basarisiz. Yukaridaki cikti son satirlara bakin.
    pause
    exit /b 1
)

echo.
echo ============================================================================
echo    DERLEME TAMAMLANDI
echo ----------------------------------------------------------------------------
if exist "%OUT_EXE%" echo    Uygulama (exe)  : %OUT_EXE%
if exist "%OUT_BUNDLE%" echo    Kurulum paketi  : %OUT_BUNDLE%
echo ============================================================================
echo.

REM ---------- Cikti klasorunu Explorer'da ac (varsa exe'yi secili getir) ----------
if exist "%OUT_EXE%" (
    explorer.exe /select,"%OUT_EXE%"
    goto :opened
)
if exist "%OUT_BUNDLE%" (
    explorer.exe "%OUT_BUNDLE%"
    goto :opened
)
if exist "%OUT_RELEASE%" (
    explorer.exe "%OUT_RELEASE%"
    goto :opened
)
echo [WARN] Cikti klasoru bulunamadi: %OUT_RELEASE%

:opened
echo.
pause
endlocal
exit /b 0
