# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the pgGuardian desktop sidecar.

Freezes the FastAPI app, the bundled static UI (``src/pgguardian/web``) and the
SQL resources into a single executable. The Tauri shell spawns this binary and
points its window at the loopback URL the sidecar prints on stdout.

The output name gets the Rust host target triple appended (e.g.
``pgguardian-desktop-x86_64-pc-windows-msvc.exe``) because that is exactly how
Tauri resolves ``bundle.externalBin``.

Build (builds against the project venv):
    pyinstaller --noconfirm --distpath src-tauri/binaries packaging/pgguardian-desktop.spec
"""

import subprocess
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

ROOT = Path(SPECPATH).resolve().parent
PACKAGE_DIR = ROOT / "src" / "pgguardian"
WEB_DIR = PACKAGE_DIR / "web"
SQL_DIR = ROOT / "sql"

# The package must be importable for collect_submodules below.
sys.path.insert(0, str(ROOT / "src"))


def _target_triple() -> str:
    """Rust host triple, used to suffix the sidecar binary for Tauri."""
    try:
        out = subprocess.run(
            ["rustc", "-vV"], capture_output=True, text=True, check=True
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return ""
    for line in out.splitlines():
        if line.startswith("host:"):
            return line.split(":", 1)[1].strip()
    return ""


datas = []
if WEB_DIR.is_dir():
    datas.append((str(WEB_DIR), "pgguardian/web"))
if SQL_DIR.is_dir():
    datas.append((str(SQL_DIR), "pgguardian/sql"))

hiddenimports = collect_submodules("pgguardian") + [
    "uvicorn.logging",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.protocols.websockets.wsproto_impl",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "sse_starlette.sse",
]

_triple = _target_triple()
_name = "pgguardian-desktop" + (f"-{_triple}" if _triple else "")

a = Analysis(
    [str(ROOT / "packaging" / "desktop_entry.py")],
    pathex=[str(ROOT / "src")],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "pytest"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name=_name,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    # Kept as a console app so the shell can read the READY handshake from
    # stdout. The shell spawns it with CREATE_NO_WINDOW and the entry point
    # hides the console window at startup, so no window ever shows.
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
