"""PyInstaller entry point for the pgGuardian desktop sidecar.

Kept as a standalone script (outside the package) so PyInstaller does not see
``pgguardian.desktop.server`` as both the entry script and a package module.
"""

from pgguardian.desktop.server import main

if __name__ == "__main__":
    raise SystemExit(main())
