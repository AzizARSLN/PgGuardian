"""SQL file loader.

Diagnostic SQL lives in ``sql/<area>/<name>.sql`` at the repository root
(single source of truth) and is packaged into the wheel as
``pgguardian/sql/...`` via ``force-include``. This loader checks the
packaged resources first, then the source tree, so both installed and
checkout usage work.
"""

from __future__ import annotations

from importlib import resources
from pathlib import Path


class SqlNotFoundError(FileNotFoundError):
    """Raised when a diagnostic SQL file cannot be located."""


def _repo_root() -> Path:
    # src/pgguardian/database/queries.py -> parents[3] == repository root
    return Path(__file__).resolve().parents[3]


def load_sql(area: str, name: str) -> str:
    """Load a diagnostic query by area and name (without the ``.sql`` suffix)."""
    filename = f"{name}.sql"

    # 1. Packaged resources (installed wheel).
    try:
        packaged = resources.files("pgguardian").joinpath(f"sql/{area}/{filename}")
        if packaged.is_file():
            return packaged.read_text(encoding="utf-8")
    except (FileNotFoundError, ModuleNotFoundError, TypeError, ValueError):
        pass

    # 2. Repository checkout layout.
    for base in (_repo_root(), Path.cwd()):
        candidate = base / "sql" / area / filename
        if candidate.is_file():
            return candidate.read_text(encoding="utf-8")

    raise SqlNotFoundError(f"Diagnostic SQL not found: sql/{area}/{filename}")
