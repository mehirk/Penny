from functools import lru_cache
from typing import Literal, Self

from pydantic import AnyHttpUrl, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Later files win, so a developer's .env.local overrides the shared .env.
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"), env_prefix="PENNY_", extra="ignore"
    )

    environment: Literal["development", "test", "production"] = "development"
    frontend_origin: AnyHttpUrl = AnyHttpUrl("http://localhost:3000")
    # Origin of the bundled iOS app (Capacitor); empty to refuse it.
    native_app_origin: str = "capacitor://localhost"
    # More browser origins allowed to call the API, comma-separated (e.g. a hosted frontend).
    extra_origins: str = ""
    # Postgres connection string (Supabase: Connect → Session pooler). Without it, data lives
    # in memory and resets when the server restarts.
    database_url: SecretStr | None = None
    supabase_url: AnyHttpUrl | None = None
    supabase_jwt_audience: str = "authenticated"
    # Legacy HS256 shared secret; hosted projects with asymmetric keys should leave it unset.
    supabase_jwt_secret: str | None = None
    # Fictional demo bearer token; accepted only when environment is "development".
    demo_auth_token: str | None = None
    # Supabase user id that gets the fictional Maya data set.
    demo_owner_user_id: str | None = None
    openai_api_key: str | None = None
    openai_model: str = "gpt-6.1-sol"
    # Upper bound for one coach reply, including every tool round and any revision.
    coach_timeout_seconds: float = 45.0

    @field_validator("database_url", mode="before")
    @classmethod
    def _empty_is_unset(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value

    @model_validator(mode="after")
    def _check_demo_token(self) -> Self:
        if self.demo_auth_token and self.environment != "development":
            raise ValueError("PENNY_DEMO_AUTH_TOKEN must not be set outside development")
        if self.demo_auth_token and self.database_url and not self.demo_owner_user_id:
            # Saved data belongs to a Supabase user; the demo identity borrows the owner's.
            raise ValueError("Set PENNY_DEMO_OWNER_USER_ID to use the demo token with a database")
        return self

    @property
    def allowed_origins(self) -> list[str]:
        origins = [str(self.frontend_origin).rstrip("/"), self.native_app_origin]
        origins += [item.strip().rstrip("/") for item in self.extra_origins.split(",")]
        return [origin for origin in dict.fromkeys(origins) if origin]

    @property
    def supabase_issuer(self) -> str | None:
        if not self.supabase_url:
            return None
        return f"{str(self.supabase_url).rstrip('/')}/auth/v1"

    @property
    def supabase_jwks_url(self) -> str | None:
        issuer = self.supabase_issuer
        return f"{issuer}/.well-known/jwks.json" if issuer else None


@lru_cache
def get_settings() -> Settings:
    return Settings()
