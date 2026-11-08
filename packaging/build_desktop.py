"""Build the self-contained pgGuardian desktop app.

Pipeline:
    1. Compile the Next.js static export        (frontend/out)
    2. Stage it inside the Python package       (src/pgguardian/web)
    3. Freeze the sidecar with PyInstaller      (src-tauri/binaries)
    4. Bundle the shell with Tauri              (src-tauri/target)

Requirements: the frontend deps, a Python environment with the ``desktop``
extras (PyInstaller), the Rust toolchain and the Tauri CLI. Each step can be
skipped to rebuild only part of the pipeline.

    python packaging/build_desktop.py [--skip-frontend] [--skip-sidecar] [--skip-tauri]
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
FRONTEND_OUT = FRONTEND / "out"
WEB_TARGET = ROOT / "src" / "pgguardian" / "web"
SPEC = ROOT / "packaging" / "pgguardian-desktop.spec"
BINARIES = ROOT / "src-tauri" / "binaries"
TAURI_DIR = ROOT / "src-tauri"


def run(cmd: list[str], cwd: Path | None = None) -> None:
    print(f"+ {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=True, shell=os.name == "nt")


def build_frontend() -> None:
    """Compile the static export (stashes the server-only entry points)."""
    run(["npm", "run", "build:desktop"], cwd=FRONTEND)


def stage_web() -> None:
    """Copy the static export into the Python package for bundling."""
    if not (FRONTEND_OUT / "index.html").is_file():
        raise SystemExit("frontend/out is missing; run the frontend build first")
    if WEB_TARGET.exists():
        shutil.rmtree(WEB_TARGET)
    shutil.copytree(FRONTEND_OUT, WEB_TARGET)
    print(f"staged static UI -> {WEB_TARGET}")


def build_sidecar() -> None:
    """Freeze the FastAPI + static UI into the Tauri sidecar executable."""
    BINARIES.mkdir(parents=True, exist_ok=True)
    run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--distpath",
            str(BINARIES),
            "--workpath",
            str(ROOT / "desktop-build"),
            str(SPEC),
        ],
        cwd=ROOT,
    )


def stop_running_app() -> None:
    """Stop a running app/sidecar so Tauri can refresh the bundled binaries.

    Tauri's build script deletes the previously copied sidecar before writing
    the new one. A running instance locks the file and the build aborts with an
    opaque "Access is denied" error, so close it first.
    """
    if os.name != "nt":
        return
    for image in ("pgguardian-desktop.exe", "pgguardian.exe"):
        result = subprocess.run(
            ["taskkill", "/F", "/IM", image],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            print(f"stopped running {image}")
    time.sleep(1)


def build_shell() -> None:
    """Bundle the Tauri shell (embeds frontend/out + the sidecar)."""
    stop_running_app()
    run(["cargo", "tauri", "build"], cwd=TAURI_DIR)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-frontend", action="store_true", help="reuse frontend/out")
    parser.add_argument("--skip-sidecar", action="store_true", help="reuse the frozen sidecar")
    parser.add_argument("--skip-tauri", action="store_true", help="stop before the Tauri bundle")
    args = parser.parse_args()

    if not args.skip_frontend:
        build_frontend()
        stage_web()
    if not args.skip_sidecar:
        build_sidecar()
    if not args.skip_tauri:
        build_shell()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
