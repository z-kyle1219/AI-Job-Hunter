"""What a profile is missing, decided by rules rather than by a model.

Asked "what else would you like to know", a model produces plausible gaps: a
certification the person never mentioned, a metric that would look good, a skill
that pairs nicely with the others. A page that tells a user to add those is
worse than a page that tells them nothing, because the user cannot tell a real
gap from an invented one.

Every item here comes from a check that can be re-run and pointed at: a field is
empty, or a line has no date, or a line has no number. The output is a question
to type an answer into — not something for a model to fill in.

The list is deliberately short. A checklist of twenty items is a checklist
nobody reads; the ones that actually block a usable resume come first.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

from .schemas import PendingField

# Whether a line claims a time range at all. Deliberately loose: the question is
# "is there a date here", not "parse it".
_DATE_HINT = re.compile(r"(?:19|20)\d{2}|\d{1,2}\s*月|至今|now|present", re.I)

# A date or a range of dates. Subtracting only the year was not enough:
# 2023.6-2023.9 would leave .6 and .9 behind, and those digits are not a result.
# Digits are only consumed when they are attached to date punctuation, so a
# number that merely follows a date ("2023.6 提升 40%") survives.
_DATE_RUN = re.compile(
    r"(?:19|20)\d{2}(?:[./\-年]\d{1,4}(?:[./月]\d{1,2}日?)?)*(?:\s*至今)?"
    r"|\d{1,2}\s*月",
)
_DIGIT = re.compile(r"\d")

_EXCERPT_CHARS = 18


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _excerpt(line: str) -> str:
    cleaned = " ".join(line.split())
    return cleaned if len(cleaned) <= _EXCERPT_CHARS else cleaned[:_EXCERPT_CHARS] + "…"


def pending_fields(
    *,
    personal_info: Mapping[str, Any],
    capabilities: Mapping[str, Any],
    display_name: str,
) -> list[PendingField]:
    """The questions a profile cannot answer for itself, most important first."""

    info = personal_info or {}
    full_name = _text(info.get("full_name"))
    phone = _text(info.get("phone"))
    email = _text(info.get("email"))
    city = _text(info.get("city"))
    links = [str(item).strip() for item in (info.get("links") or []) if str(item).strip()]

    items: list[PendingField] = []

    if full_name:
        pass
    else:
        items.append(
            PendingField(
                field="full_name",
                label="姓名",
                # The nickname is a real fallback, so this is advice, not a wall.
                ask=f"简历抬头目前会用昵称「{display_name}」，要换成真实姓名吗？",
                why="投递用的简历上，招聘方按名字找人。",
            )
        )

    if not phone:
        items.append(
            PendingField(
                field="phone",
                label="手机号",
                ask="留一个能打通的手机号是多少？",
                why="国内投递渠道基本靠电话约面，没有号码这份简历发出去也联系不上。",
                blocking=True,
            )
        )

    if not email:
        items.append(
            PendingField(
                field="email",
                label="邮箱",
                ask="简历上要不要留邮箱？账号邮箱可以直接用。",
                why="部分公司只发邮件，且需要能收附件通知。",
            )
        )

    if not city:
        items.append(
            PendingField(
                field="city",
                label="所在城市",
                ask="现在在哪个城市？可以接受异地面试吗？",
                why="岗位按城市筛人，写清城市能少掉一批无效沟通。",
            )
        )

    if not links:
        items.append(
            PendingField(
                field="links",
                label="作品 / 主页链接",
                ask="有 GitHub、博客或作品集链接吗？",
                why="技术岗看代码比看描述快。",
            )
        )

    experiences = [
        _text(item) for item in (capabilities or {}).get("experiences", []) if _text(item)
    ]
    for line in experiences:
        has_date = bool(_DATE_HINT.search(line))
        if not has_date:
            items.append(
                PendingField(
                    field="experience_period",
                    label="经历时间",
                    ask=f"「{_excerpt(line)}」的起止时间是什么时候？",
                    why="没有时间的经历，招聘方无法判断你的阶段和时长。",
                )
            )
        # Dates are digits, so they are removed before asking "is there a result
        # number": otherwise every dated line counts as quantified. The whole
        # date goes, not just the year, or the leftover ".6" counts too.
        remainder = _DATE_RUN.sub("", line)
        if not _DIGIT.search(remainder):
            items.append(
                PendingField(
                    field="experience_result",
                    label="量化结果",
                    ask=f"「{_excerpt(line)}」做出过什么可衡量的结果？",
                    why="一个数字比三个形容词有说服力。",
                )
            )

    # Blocking first, then the order the checks ran in, which is the order a
    # reader would fill a form: who you are, how to reach you, what you did.
    return sorted(items, key=lambda item: not item.blocking)


def has_blocking(items: Sequence[PendingField]) -> bool:
    return any(item.blocking for item in items)
