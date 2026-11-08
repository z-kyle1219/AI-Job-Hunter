from __future__ import annotations

import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.models import Base
from backend.app.profile_gaps import pending_fields
from backend.app.schemas_resources import (
    CapabilityProfile,
    PersonalInfo,
    ProfileCreate,
    UserCreate,
    UserRequirements,
)
from backend.app.services import (
    create_profile,
    create_user,
    pending_for_profile,
    update_personal_info,
)

FULL_PERSONAL = {
    "full_name": "刘瑾",
    "phone": "13800000000",
    "email": "liu@example.com",
    "city": "北京",
    "links": ["https://github.com/example"],
}


def _gaps(**personal: object) -> list:
    return pending_fields(
        personal_info=personal,
        capabilities={"experiences": []},
        display_name="娜娜",
    )


class PendingFieldRuleTest(unittest.TestCase):
    def test_an_empty_profile_asks_for_a_phone_first(self) -> None:
        items = _gaps()

        self.assertTrue(items)
        # Blocking items come first: a resume nobody can call back is not usable.
        self.assertEqual(items[0].field, "phone")
        self.assertTrue(items[0].blocking)
        self.assertFalse(any(item.blocking for item in items[1:]))

    def test_the_name_question_offers_the_nickname_rather_than_demanding(self) -> None:
        items = _gaps(full_name="")

        name = next(item for item in items if item.field == "full_name")
        self.assertIn("娜娜", name.ask)
        # A nickname is a real fallback, so it is advice and not a wall.
        self.assertFalse(name.blocking)

    def test_a_complete_profile_asks_nothing(self) -> None:
        items = pending_fields(
            personal_info=FULL_PERSONAL,
            capabilities={"experiences": ["字节跳动 后端实习 2023.6-2023.9：QPS 提升 40%"]},
            display_name="娜娜",
        )

        self.assertEqual(items, [])

    def test_an_experience_without_a_date_is_asked_about_by_quote(self) -> None:
        items = pending_fields(
            personal_info=FULL_PERSONAL,
            capabilities={"experiences": ["负责推荐接口优化，QPS 提升 40%"]},
            display_name="娜娜",
        )

        period = next(item for item in items if item.field == "experience_period")
        self.assertIn("负责推荐接口优化", period.ask)
        self.assertFalse(period.blocking)

    def test_an_experience_without_a_number_is_asked_about(self) -> None:
        items = pending_fields(
            personal_info=FULL_PERSONAL,
            capabilities={"experiences": ["2023.6-2023.9 在字节跳动做后端实习，负责接口优化"]},
            display_name="娜娜",
        )

        result = next(item for item in items if item.field == "experience_result")
        self.assertIn("2023.6-2023.9", result.ask)

    def test_the_list_never_invents_a_field_outside_the_rules(self) -> None:
        allowed = {
            "full_name",
            "phone",
            "email",
            "city",
            "links",
            "experience_period",
            "experience_result",
        }

        items = pending_fields(
            personal_info={"full_name": ""},
            capabilities={"experiences": ["没时间也没数字的一段经历", "又一段"]},
            display_name="娜娜",
        )

        self.assertTrue(all(item.field in allowed for item in items))


class PersonalInfoStorageTest(unittest.TestCase):
    def setUp(self) -> None:
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.session = sessionmaker(
            bind=engine, autoflush=False, expire_on_commit=False
        )()
        self.user = create_user(
            self.session, UserCreate(email="liu@example.com", display_name="娜娜")
        )

    def tearDown(self) -> None:
        self.session.close()

    def _profile(self, *, phone: str = "", city: str = ""):
        return create_profile(
            self.session,
            ProfileCreate(
                user_id=self.user.id,
                requirements=UserRequirements(desired_role="后端开发实习生"),
                capabilities=CapabilityProfile(summary="计算机专业学生"),
                personal_info=PersonalInfo(phone=phone, city=city),
            ),
        )

    def test_reconfirming_a_profile_does_not_erase_what_was_filled_in(self) -> None:
        self._profile(phone="13800000000")

        # A confirmation round that carries no personal info at all.
        again = self._profile()

        self.assertEqual(again.personal_info["phone"], "13800000000")

    def test_personal_info_is_merged_field_by_field(self) -> None:
        profile = self._profile(phone="13800000000")

        update_personal_info(
            self.session, profile.id, PersonalInfo(city="北京", full_name="刘瑾")
        )

        stored = self.session.get(type(profile), profile.id)
        self.assertEqual(stored.personal_info["phone"], "13800000000")
        self.assertEqual(stored.personal_info["city"], "北京")
        self.assertEqual(stored.personal_info["full_name"], "刘瑾")

    def test_pending_questions_come_from_the_stored_profile(self) -> None:
        profile = self._profile()

        items = pending_for_profile(self.session, profile.id)

        fields = [item.field for item in items]
        self.assertIn("phone", fields)
        self.assertIn("city", fields)


if __name__ == "__main__":
    unittest.main()
