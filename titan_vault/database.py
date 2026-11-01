from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, Boolean
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime, timezone
import os

Base = declarative_base()

class Token(Base):
    __tablename__ = "tokens"
    id = Column(String, primary_key=True, index=True)  # sha256 of the bearer token
    name = Column(String, nullable=False)
    policies = Column(Text, nullable=False) # JSON string
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    is_active = Column(Boolean, default=True)

class Secret(Base):
    __tablename__ = "secrets"
    id = Column(Integer, primary_key=True, index=True)
    key_path = Column(String, index=True, nullable=False)
    version = Column(Integer, nullable=False)
    encrypted_value = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    token_id = Column(String, nullable=True) # None for SYSTEM
    action = Column(String, nullable=False)
    resource = Column(String, nullable=False)
    status = Column(String, nullable=False) # SUCCESS, DENIED, ERROR

class TransitKey(Base):
    __tablename__ = "transit_keys"
    name = Column(String, primary_key=True, index=True)
    key_type = Column(String, nullable=False) # "aes-gcm", "hmac-sha256"
    encrypted_key = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


# SQLite Database connection
data_dir = os.environ.get("VAULT_DATA_DIR", ".")
os.makedirs(data_dir, exist_ok=True)
db_path = os.path.join(data_dir, "vault.db")

SQLALCHEMY_DATABASE_URL = f"sqlite:///{db_path}"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def init_db():
    Base.metadata.create_all(bind=engine)
