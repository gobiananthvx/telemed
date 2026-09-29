import os
from pydantic_settings import BaseSettings
from typing import List, Optional

class Settings(BaseSettings):
    PROJECT_NAME: str = "Telemed"
    API_V1_STR: str = "/api"
    SECRET_KEY: str = os.getenv("SECRET_KEY", "telemed_jwt_secret_key_super_secure_9847293847293847")
    ALGORITHM: str = os.getenv("ALGORITHM", "HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440")) # 24 hours
    
    # PostgreSQL Configuration
    POSTGRES_USER: str = os.getenv("POSTGRES_USER", "telemed_user")
    POSTGRES_PASSWORD: str = os.getenv("POSTGRES_PASSWORD", "telemed_password")
    POSTGRES_DB: str = os.getenv("POSTGRES_DB", "telemed_db")
    POSTGRES_PORT: str = os.getenv("POSTGRES_PORT", "5434")
    POSTGRES_HOST: str = os.getenv("POSTGRES_HOST", "localhost")
    
    # Async database URL (asyncpg)
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
    )
    # Sync database URL (psycopg2) for seeding and migrations
    SYNC_DATABASE_URL: str = os.getenv(
        "SYNC_DATABASE_URL",
        f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
    )
    
    # Email microservice (Node.js Nodemailer)
    EMAIL_SERVICE_URL: str = os.getenv("EMAIL_SERVICE_URL", "http://localhost:5001")
    
    # CORS Origins
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
        "*"
    ]

    # LLM & Chatbot Configuration
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "gemini")
    GEMINI_API_KEY: Optional[str] = os.getenv("GEMINI_API_KEY", None)
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini/gemini-1.5-flash")
    GROQ_API_KEY: Optional[str] = os.getenv("GROQ_API_KEY", None)
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "groq/llama-3.3-70b-versatile")
    CHATBOT_TIMEZONE: str = os.getenv("CHATBOT_TIMEZONE", "Asia/Kolkata")

    class Config:
        env_file = "../.env"
        extra = "ignore"

settings = Settings()
