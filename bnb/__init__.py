"""Perch — a centralised booking manager for small bed & breakfasts.

The whole product rests on one idea: a single authoritative *availability
ledger* that every channel is fed from.  Nothing writes availability straight
to Airbnb or Booking.com; a reservation writes to the ledger, and the ledger
pushes outward.  See ``bnb.ledger`` for the invariant that makes a double
booking impossible, and ``bnb.sync`` for the fail-closed sync engine.
"""

__version__ = "1.0.0"

__all__ = ["__version__"]
