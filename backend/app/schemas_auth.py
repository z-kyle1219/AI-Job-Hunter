"""The account contract: what registering and logging in look like on the wire.

The token is opaque on purpose. A client has no reason to read it, and a token
that means nothing outside this server cannot be forged by editing it.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .schemas_resources import UserRead


def _clean_email(value: str) -> str:
    """Lowercase and trim, so a login cannot miss on capitalisation.

    Kept deliberately shallow: the only thing a demo needs from an address is
    that it round-trips. A stricter grammar would reject valid addresses to
    catch typos that the confirmation mail is supposed to catch anyway.
    """

    email = value.strip().lower()
    if "@" not in email or email.startswith("@") or email.endswith("@"):
        raise ValueError("邮箱格式不正确")
    local, _, domain = email.partition("@")
    if "." not in domain or not local:
        raise ValueError("邮箱格式不正确")
    return email


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=255)
    # Eight is not a security guarantee, it is a floor that stops "123456".
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=64)

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        return _clean_email(value)

    @field_validator("display_name")
    @classmethod
    def _name(cls, value: str) -> str:
        name = value.strip()
        if not name:
            raise ValueError("昵称不能为空")
        return name


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        return _clean_email(value)


class TokenResponse(BaseModel):
    """What a successful register or login returns.

    The user comes back with the token so the client does not have to spend a
    second round trip finding out who it just logged in as.
    """

    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_at: datetime
    user: UserRead
