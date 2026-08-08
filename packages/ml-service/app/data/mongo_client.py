from pymongo import MongoClient
from app.config import MONGODB_URI

_client = None


def get_db():
    global _client
    if _client is None:
        _client = MongoClient(MONGODB_URI)
    db_name = MONGODB_URI.rsplit("/", 1)[-1].split("?")[0] or "trading"
    return _client[db_name]


def get_collection(name: str):
    return get_db()[name]
