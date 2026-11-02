"""Each person's financial data and every operation on it.

`DashboardStore` holds one person's data in memory and returns a freshly calculated dashboard
snapshot after every change; `stores` picks the right store for a signed-in user. The store
knows nothing about the database: `snapshot()` and the constructor hand its state to app/db.
"""

from app.store.registry import StoreRegistry, demo_store, fresh_store, stores
from app.store.state import StoreSnapshot
from app.store.store import DashboardStore

__all__ = [
    "DashboardStore",
    "StoreRegistry",
    "StoreSnapshot",
    "demo_store",
    "fresh_store",
    "stores",
]
