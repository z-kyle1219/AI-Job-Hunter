"""Accounts: creating one, proving it is yours, and revoking that proof.

Passwords are hashed with ``hashlib.scrypt`` from the standard library, so
"we have passwords" does not mean "we added a dependency we have to keep
patched". A stored value carries its own parameters
(``scrypt$n$r$p$salt$digest``), so the cost can be raised later without
invalidating the hashes already in the table: an old row still verifies with the
numbers it was written with.

Sessions are opaque random tokens, stored as their SHA-256. A signed token would
mean fewer writes, but a signature cannot be revoked — the only way to log
someone out would be to rotate the key and log everyone out. A row also means a
stolen database hands out hashes, not working tokens.

Accounts created before auth existed have no password. They are not given an
invented one: registering with that email adopts the row and sets the password,
which keeps a demo dataset usable without pretending a stranger proved anything.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .models import AuthSession, User, as_utc, utc_now

# scrypt parameters. 2**14 / 8 / 1 is roughly 16MB and a few tens of
# milliseconds per hash — slow enough to matter for guessing, fast enough that
# logging in does not feel broken.
SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 32

TOKEN_BYTES = 32
DEFAULT_TTL_HOURS = 24 * 7


class AuthError(ValueError):
    """Base class for the rejections this module produces."""


class EmailAlreadyRegisteredError(AuthError):
    """An account with this email already has a password."""


class InvalidCredentialsError(AuthError):
    """Email and password do not match."""


class PasswordNotSetError(AuthError):
    """The account exists but predates passwords."""


class InvalidTokenError(AuthError):
    """The token is unknown, expired or revoked."""


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=SCRYPT_DKLEN,
    )
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Verify against the parameters the hash was written with, not today's."""

    try:
        scheme, n, r, p, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    if scheme != "scrypt":
        return False
    try:
        expected = bytes.fromhex(digest_hex)
        digest = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt_hex),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(expected),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest, expected)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _ttl() -> timedelta:
    raw = os.getenv("AUTH_TOKEN_TTL_HOURS", "").strip()
    try:
        hours = float(raw) if raw else float(DEFAULT_TTL_HOURS)
    except ValueError:
        hours = float(DEFAULT_TTL_HOURS)
    return timedelta(hours=max(1.0, hours))


def normalize_email(email: str) -> str:
    """Emails are stored lowercased, so a login cannot miss on capitalisation."""

    return email.strip().lower()


# RFC 5322 atext plus the dot, the punctuation a local part may contain.
_LOCAL_PUNCTUATION = frozenset("!#$%&'*+-/=?^_`{|}~.")


def clean_email(value: str) -> str:
    """Validate the address shape and normalise it, or reject it.

    This app sends no mail — there is no mail transport anywhere in it — so
    nothing downstream ever confirms that an address exists. The grammar below
    is therefore the only thing between a mistyped address and an account
    nobody can ever reach: it is strict where typos live (``a@.com``,
    ``test@.``, ``a@@b.com``, stray spaces) and tolerant where real addresses
    live (unicode local parts and domains, plus-addressing, dotted locals).

    Deliberately a pragmatic subset of RFC 5322, not the whole thing: quoted
    local parts and IP-literal domains are refused rather than half-checked.
    """

    email = normalize_email(value)
    local, at, domain = email.partition("@")
    if len(email) > 254 or not at or "@" in domain or not local or len(local) > 64:
        raise ValueError("邮箱格式不正确")
    if local.startswith(".") or local.endswith(".") or ".." in local:
        raise ValueError("邮箱格式不正确")
    if any(not (ch.isalnum() or ch in _LOCAL_PUNCTUATION) for ch in local):
        raise ValueError("邮箱格式不正确")

    labels = domain.split(".")
    if len(labels) < 2:
        raise ValueError("邮箱格式不正确")
    for label in labels:
        if not label or len(label) > 63:
            raise ValueError("邮箱格式不正确")
        if label.startswith("-") or label.endswith("-"):
            raise ValueError("邮箱格式不正确")
        if any(not (ch.isalnum() or ch == "-") for ch in label):
            raise ValueError("邮箱格式不正确")
    # The TLD is the part a typo is most likely to damage, so it must read as
    # a word: "a@b.c" and "a@b.c0m" are not addresses anyone can receive at.
    tld = labels[-1]
    if len(tld) < 2 or not all(ch.isalpha() for ch in tld):
        raise ValueError("邮箱格式不正确")
    return email


def _issue_token(session: Session, user_id: str) -> tuple[str, datetime]:
    token = secrets.token_urlsafe(TOKEN_BYTES)
    expires_at = utc_now() + _ttl()
    session.add(
        AuthSession(
            id=uuid.uuid4().hex,
            user_id=user_id,
            token_hash=_token_hash(token),
            expires_at=expires_at,
        )
    )
    session.commit()
    return token, expires_at


def register(
    session: Session, *, email: str, password: str, display_name: str
) -> tuple[User, str, datetime]:
    """Create an account, or adopt a pre-auth one with the same email.

    Adopting is the only path for a row that has no password, and it is also
    the reason the caller must send a display name: an account that is being
    claimed may have been created before anyone asked for one.
    """

    normalized = normalize_email(email)
    existing = session.scalar(select(User).where(User.email == normalized))

    if existing is not None:
        if existing.password_hash:
            raise EmailAlreadyRegisteredError("这个邮箱已经注册过了，直接登录")
        existing.password_hash = hash_password(password)
        existing.display_name = display_name.strip()
        session.commit()
        session.refresh(existing)
        token, expires_at = _issue_token(session, existing.id)
        return existing, token, expires_at

    user = User(
        id=uuid.uuid4().hex,
        email=normalized,
        display_name=display_name.strip(),
        password_hash=hash_password(password),
    )
    session.add(user)
    try:
        session.commit()
    except IntegrityError as exc:
        # Two registrations for one email arriving together: the unique index
        # decides, and the loser is told what happened rather than a 500.
        session.rollback()
        raise EmailAlreadyRegisteredError("这个邮箱已经注册过了，直接登录") from exc

    session.refresh(user)
    token, expires_at = _issue_token(session, user.id)
    return user, token, expires_at


def login(session: Session, *, email: str, password: str) -> tuple[User, str, datetime]:
    """Prove the password. Unknown email and wrong password answer the same.

    Same message on purpose: otherwise the login form becomes a way to ask
    "does this person have an account here". The one exception is an account
    with no password yet, which says so — that account cannot be logged into by
    anyone, and the person who owns the address needs to know why.
    """

    user = session.scalar(select(User).where(User.email == normalize_email(email)))
    if user is None:
        raise InvalidCredentialsError("邮箱或密码不正确")
    if not user.password_hash:
        raise PasswordNotSetError(
            "这个账号还没有设置密码；用同一邮箱注册一次即可设置"
        )
    if not verify_password(password, user.password_hash):
        raise InvalidCredentialsError("邮箱或密码不正确")

    token, expires_at = _issue_token(session, user.id)
    return user, token, expires_at


def resolve_token(session: Session, token: str) -> User:
    """The user behind a token, or an error that says why it is not usable."""

    record = session.scalar(
        select(AuthSession).where(AuthSession.token_hash == _token_hash(token))
    )
    if record is None or record.revoked_at is not None:
        raise InvalidTokenError("登录状态已失效，请重新登录")
    if as_utc(record.expires_at) <= utc_now():
        raise InvalidTokenError("登录状态已过期，请重新登录")

    user = session.get(User, record.user_id)
    if user is None:
        raise InvalidTokenError("登录状态已失效，请重新登录")
    return user


def revoke_token(session: Session, token: str) -> None:
    """Log out. An unknown token is not an error — logging out twice is fine."""

    record = session.scalar(
        select(AuthSession).where(AuthSession.token_hash == _token_hash(token))
    )
    if record is None or record.revoked_at is not None:
        return
    record.revoked_at = utc_now()
    session.commit()
