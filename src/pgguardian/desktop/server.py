"""Desktop entry point: run the API + bundled UI on a loopback port.

Used as the Tauri sidecar. It configures the self-contained defaults (embedded
SQLite metadata store, a stable JWT secret under the per-user data directory) and
announces the chosen port on stdout so the shell can point its webview at it:

    PGGUARDIAN_READY http://127.0.0.1:<port>

Run directly for a manual desktop smoke test:  python -m pgguardian.desktop.server
"""

from __future__ import annotations

import os
import secrets
import socket
import sys
import threading
import time
from pathlib import Path

READY_PREFIX = "PGGUARDIAN_READY"
ERROR_PREFIX = "PGGUARDIAN_ERROR"


def app_data_dir() -> Path:
    """Per-user writable directory for the embedded database and secrets."""
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or str(Path.home())
        return Path(base) / "pgGuardian"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "pgGuardian"
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "pgGuardian"


def _persistent_secret(path: Path) -> str:
    """Read (or create once) the signing secret so sessions survive restarts."""
    if path.is_file():
        value = path.read_text(encoding="utf-8").strip()
        if value:
            return value
    value = secrets.token_urlsafe(48)
    path.write_text(value, encoding="utf-8")
    return value


def _free_port(host: str) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return int(sock.getsockname()[1])


def _hide_console_window() -> None:
    """Hide the console window of a frozen Windows build.

    The desktop shell spawns this sidecar with ``CREATE_NO_WINDOW``, so it
    usually has no console at all. Windows still allocates one when the frozen
    executable is started directly (for example by double-clicking it); hide it
    so a shared build never flashes a black window. A normal interpreter run is
    left untouched, keeping the developer's terminal visible.
    """
    if sys.platform != "win32" or not getattr(sys, "frozen", False):
        return
    try:
        import ctypes

        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 0)  # SW_HIDE
    except Exception:  # pragma: no cover - cosmetic, never fail the app for it
        pass


def prepare_environment() -> Path:
    """Set the desktop defaults before the app/settings are imported."""
    data_dir = app_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)

    os.environ.setdefault("PGGUARDIAN_DESKTOP", "1")
    # Yerel, tek kullanıcılı uygulama: tüm mutasyonlar (VACUUM/ANALYZE, cancel,
    # DROP, terminate, REINDEX, ALTER SYSTEM, restore, ...) varsayılan olarak
    # açık. Paylaşılan bir derleme kapatmak isterse PGGUARDIAN_ALLOW_WRITES=0 /
    # PGGUARDIAN_ALLOW_DANGEROUS=0 ile bunu geçersiz kılabilir.
    os.environ.setdefault("PGGUARDIAN_ALLOW_WRITES", "1")
    os.environ.setdefault("PGGUARDIAN_ALLOW_DANGEROUS", "1")
    os.environ.setdefault("PGGUARDIAN_CENTRAL_BACKEND", "sqlite")
    os.environ.setdefault("PGGUARDIAN_CENTRAL_DB_FILE", str(data_dir / "central.db"))
    os.environ.setdefault("PGGUARDIAN_JWT_SECRET", _persistent_secret(data_dir / "jwt_secret"))
    os.environ.setdefault("PGGUARDIAN_COOKIE_SECURE", "0")
    # Dağıtılan masaüstü derlemesi lisans ister: lisans etkinleştirilene kadar
    # yalnızca salt-okunur uçlar çalışır, mutasyonlar 403 döner. Geliştirme /
    # iç kullanım için PGGUARDIAN_LICENSE_ENFORCED=0 ile kapatılabilir.
    os.environ.setdefault("PGGUARDIAN_LICENSE_ENFORCED", "1")
    return data_dir


def main() -> int:
    _hide_console_window()
    prepare_environment()

    import uvicorn

    from pgguardian.api.app import app as api_app

    host = os.environ.get("PGGUARDIAN_DESKTOP_HOST", "127.0.0.1")
    configured = os.environ.get("PGGUARDIAN_DESKTOP_PORT")
    port = int(configured) if configured else _free_port(host)

    server = uvicorn.Server(
        uvicorn.Config(api_app, host=host, port=port, log_level="warning", access_log=False)
    )

    def _announce() -> None:
        deadline = time.monotonic() + 30
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.05)
        if server.started:
            print(f"{READY_PREFIX} http://{host}:{port}", flush=True)
        else:
            print(f"{ERROR_PREFIX} server failed to start", file=sys.stderr, flush=True)

    threading.Thread(target=_announce, name="pgguardian-ready", daemon=True).start()

    # uvicorn runs on the main thread so Ctrl+C and shutdown signals work.
    server.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
