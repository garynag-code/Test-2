"""``python -m chatgpt_export`` launches the web portal (the friendly default).
Use ``python -m chatgpt_export.cli`` for the command-line interface.
"""

from .web import main

if __name__ == "__main__":
    raise SystemExit(main())
