"""Package entry point: ``python -m pgguardian`` behaves like the ``pgguardian`` CLI."""

from pgguardian.cli.app import app

if __name__ == "__main__":
    app()
