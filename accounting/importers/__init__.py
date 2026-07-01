"""Bank-statement importers.

``load_file`` dispatches on file extension: CSV is handled by the standard
library; PDF is delegated to the optional :mod:`pdf_importer` (which needs
``pdfplumber``). Both yield :class:`accounting.models.BankTransaction` objects
with a stable ``external_id`` so re-importing the same statement is a no-op.
"""

from __future__ import annotations

from pathlib import Path
from typing import List, Union

from ..models import BankTransaction
from . import csv_importer


def load_file(path: Union[str, Path], **kwargs) -> List[BankTransaction]:
    p = Path(path)
    suffix = p.suffix.lower()
    if suffix == ".csv":
        return csv_importer.parse_file(p, **kwargs)
    if suffix == ".pdf":
        from . import pdf_importer  # imported lazily; optional dependency
        return pdf_importer.parse_file(p, **kwargs)
    raise ValueError(f"unsupported statement format: {suffix!r} (use .csv or .pdf)")


__all__ = ["load_file", "csv_importer"]
