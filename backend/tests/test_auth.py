from __future__ import annotations

import unittest
from datetime import timedelta

from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from backend.app.auth import (
    EmailAlreadyRegisteredError,
    InvalidCredentialsError,
    InvalidTokenError,
    PasswordNotSetError,
    login,
    register,
    resolve_token,
    revoke_token,
    verify_password,
)
from backend.app.models import AuthSession, Base, User, utc_now
from backend.app.schemas_auth import LoginRequest, RegisterRequest
from backend.app.schemas_resources import UserCreate
from backend.app.services import create_user

PASSWORD = "correct-horse-battery"


class AuthTest(unittest.TestCase):
    def setUp(self) -> None:
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.session = sessionmaker(
            bind=engine, autoflush=False, expire_on_commit=False
        )()

    def tearDown(self) -> None:
        self.session.close()

    def _register(
        self, email: str = "buyer@example.com", name: str = "小明"
    ):
        return register(
            self.session, email=email, password=PASSWORD, display_name=name
        )

    def test_registering_returns_a_working_token(self) -> None:
        user, token, expires_at = self._register()

        self.assertTrue(token)
        self.assertGreater(expires_at, utc_now())
        self.assertEqual(user.display_name, "小明")
        self.assertEqual(resolve_token(self.session, token).id, user.id)

    def test_the_same_email_cannot_register_twice(self) -> None:
        self._register()

        with self.assertRaises(EmailAlreadyRegisteredError):
            self._register()

    def test_emails_are_matched_regardless_of_case(self) -> None:
        self._register(email="Buyer@Example.com")

        # Stored lowercased, so a login typed with capitals still finds it.
        user, token, _ = login(
            self.session, email="BUYER@example.com", password=PASSWORD
        )
        self.assertEqual(user.email, "buyer@example.com")
        self.assertTrue(token)

    def test_a_wrong_password_and_an_unknown_email_answer_the_same(self) -> None:
        self._register()

        with self.assertRaises(InvalidCredentialsError) as wrong:
            login(self.session, email="buyer@example.com", password="wrong-password")
        with self.assertRaises(InvalidCredentialsError) as unknown:
            login(self.session, email="nobody@example.com", password=PASSWORD)

        # Otherwise the form becomes a way to ask whether an account exists.
        self.assertEqual(str(wrong.exception), str(unknown.exception))

    def test_logging_out_revokes_the_token_and_leaves_the_others(self) -> None:
        user, token, _ = self._register()
        _, second_token, _ = login(
            self.session, email="buyer@example.com", password=PASSWORD
        )

        revoke_token(self.session, token)

        with self.assertRaises(InvalidTokenError):
            resolve_token(self.session, token)
        # One device logging out is not every device logging out.
        self.assertEqual(resolve_token(self.session, second_token).id, user.id)
        # Logging out twice is not an error.
        revoke_token(self.session, token)

    def test_an_expired_token_is_refused(self) -> None:
        _, token, _ = self._register()
        record = self.session.scalar(select(AuthSession))
        record.expires_at = utc_now() - timedelta(hours=1)
        self.session.commit()

        with self.assertRaises(InvalidTokenError):
            resolve_token(self.session, token)

    def test_an_account_without_a_password_is_adopted_not_duplicated(self) -> None:
        # What a row created before auth existed looks like.
        legacy = create_user(
            self.session, UserCreate(email="old@example.com", display_name="Old")
        )

        with self.assertRaises(PasswordNotSetError):
            # A NULL hash must never read as "no password required".
            login(self.session, email="old@example.com", password="")

        claimed, token, _ = register(
            self.session,
            email="old@example.com",
            password=PASSWORD,
            display_name="旧账号",
        )

        self.assertEqual(claimed.id, legacy.id)
        self.assertEqual(claimed.display_name, "旧账号")
        self.assertEqual(self.session.scalar(select(User)).id, legacy.id)
        self.assertEqual(resolve_token(self.session, token).id, legacy.id)

        # The password really was written: the next login uses it.
        again, _, _ = login(
            self.session, email="old@example.com", password=PASSWORD
        )
        self.assertEqual(again.id, legacy.id)

    def test_the_stored_hash_is_not_the_password(self) -> None:
        user, _, _ = self._register()

        self.assertIsNotNone(user.password_hash)
        self.assertNotIn(PASSWORD, user.password_hash or "")
        self.assertTrue(verify_password(PASSWORD, user.password_hash or ""))
        self.assertFalse(verify_password("something-else", user.password_hash or ""))
        # A value that is not a hash we wrote must fail closed.
        self.assertFalse(verify_password(PASSWORD, "not-a-hash"))

    def test_all_three_fields_are_required(self) -> None:
        with self.assertRaises(ValidationError):
            RegisterRequest(email="a@b.com", password="short", display_name="x")
        with self.assertRaises(ValidationError):
            RegisterRequest(email="a@b.com", password=PASSWORD, display_name="   ")
        with self.assertRaises(ValidationError):
            RegisterRequest(email="not-an-email", password=PASSWORD, display_name="x")

    def test_an_email_has_to_look_like_an_address(self) -> None:
        # Nothing in this app ever sends mail, so the grammar is the only
        # thing standing between a typo and an account nobody can reach.
        typos = (
            "test",
            "123456",
            "abc@",
            "@.com",
            "a@.com",
            "test@.",
            "a@b.",
            "a@b..",
            "a@@b.com",
            "a b@c.com",
            "a@b.c",
            "a@b..com",
            "a@-b.com",
            "a@b-.com",
            ".a@b.com",
            "a.@b.com",
            "a..b@c.com",
            "a@b.com/x",
        )
        for bad in typos:
            with self.assertRaises(ValidationError, msg=bad):
                RegisterRequest(email=bad, password=PASSWORD, display_name="x")
            with self.assertRaises(ValidationError, msg=bad):
                LoginRequest(email=bad, password=PASSWORD)

        for good in (
            "buyer@example.com",
            "first.last+tag@sub.example.org",
            "张三@例子.公司",
        ):
            request = RegisterRequest(email=good, password=PASSWORD, display_name="x")
            self.assertEqual(request.email, good.strip().lower())


if __name__ == "__main__":
    unittest.main()
