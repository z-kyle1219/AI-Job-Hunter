from __future__ import annotations

import re

from .schemas import FitReport, JobInput, JobRequirementSet, ProfileInput


_CJK_RUN_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]+")
_ASCII_TERM_RE = re.compile(r"[A-Za-z0-9+#]{2,}")
_EN_STOPWORDS = {"and", "the", "with", "for", "you", "are", "this"}
# Chinese JD filler carries no skill signal. Splitting on it keeps the coverage
# ratio honest and stops reported gaps from reading like 熟悉/掌握.
_CJK_FILLERS = (
    "熟悉",
    "熟练",
    "精通",
    "掌握",
    "了解",
    "具备",
    "具有",
    "优先",
    "相关",
    "以及",
    "或者",
    "我们",
    "你们",
    "岗位",
    "职责",
    "任职",
    "加分",
    "要求",
    "能力",
    "以上",
    "和",
    "与",
    "及",
    "的",
    "了",
    "在",
    "有",
)
_CJK_SPLIT_RE = re.compile("|".join(re.escape(word) for word in _CJK_FILLERS))
_DISPLAY_LIMIT = 5


def _cjk_segments(value: str) -> list[str]:
    """Split Chinese text into filler-free phrases of at least two characters."""

    segments: list[str] = []
    for run in _CJK_RUN_RE.findall(value):
        segments.extend(
            part for part in _CJK_SPLIT_RE.split(run) if len(part) >= 2
        )
    return segments


def _cjk_terms(value: str) -> set[str]:
    """Character bigrams for Chinese text.

    Chinese has no whitespace tokenisation, so the previous ASCII-only pattern
    dropped every Chinese skill and requirement. Bigrams need no dictionary and
    still catch partial matches such as 机器学习 vs 机器学习算法.
    """

    terms: set[str] = set()
    for segment in _cjk_segments(value):
        terms.update(
            segment[index : index + 2] for index in range(len(segment) - 1)
        )
    return terms


def _terms(value: str) -> set[str]:
    ascii_terms = {
        token
        for token in _ASCII_TERM_RE.findall(value.lower())
        if token not in _EN_STOPWORDS
    }
    return ascii_terms | _cjk_terms(value)


def _bigram_positions(segment: str, terms: set[str]) -> set[int]:
    """Character positions in ``segment`` that any of ``terms`` covers."""

    positions: set[int] = set()
    for index in range(len(segment) - 1):
        if segment[index : index + 2] in terms:
            positions.update((index, index + 1))
    return positions


def _matched_spans(
    value: str, terms: set[str], avoid: set[str] | None = None
) -> list[str]:
    """Merge matched bigrams back into readable spans, in order of appearance.

    Overlapping bigrams rebuild a phrase, but they also leak one character
    across a boundary. Scored against 推荐系统, the posting's 推荐系统经验 leaves
    统经 and 经验 unmatched, and the run used to start at 统 — a character the
    matched 系统 already accounts for — so the reported gap read 统经验.

    ``avoid`` is the opposing term set. A character it also covers is trimmed
    off the edge of a span, which turns that gap back into 经验.

    The trim is one-way on purpose. It removes a character that the matched
    side explains, so only the gap passes ``avoid``: applying it to the matched
    side would shorten a real word (推荐系统 → 推荐系) and lose more than the
    artifact it removes.
    """

    spans: list[str] = []
    for segment in _cjk_segments(value):
        unavailable = _bigram_positions(segment, avoid) if avoid else set()

        runs: list[tuple[int, int]] = []
        start = -1
        last = -1
        for index in range(len(segment) - 1):
            if segment[index : index + 2] in terms:
                if start < 0:
                    start = index
                last = index
            elif start >= 0:
                runs.append((start, last + 2))
                start = -1
        if start >= 0:
            runs.append((start, last + 2))

        for run_start, run_end in runs:
            trimmed_start, trimmed_end = run_start, run_end
            while trimmed_start < trimmed_end and trimmed_start in unavailable:
                trimmed_start += 1
            while trimmed_end > trimmed_start and (trimmed_end - 1) in unavailable:
                trimmed_end -= 1
            span = segment[trimmed_start:trimmed_end]
            # A span trimmed down to one character says less than the untrimmed
            # run did, so the original is the better of the two.
            spans.append(
                span if len(span) >= 2 else segment[run_start:run_end]
            )
    return spans


def _display_terms(
    value: str,
    terms: set[str],
    limit: int = _DISPLAY_LIMIT,
    avoid: set[str] | None = None,
) -> list[str]:
    """Report readable terms: ASCII tokens first, then merged Chinese spans."""

    ordered = sorted(term for term in terms if term.isascii())
    ordered.extend(_matched_spans(value, terms, avoid))
    unique: list[str] = []
    for term in ordered:
        if term in unique:
            continue
        unique.append(term)
        if len(unique) >= limit:
            break
    return unique


def term_set(value: str) -> set[str]:
    """Comparable terms of a text, shared with the job search.

    Public wrapper so the search does not reimplement tokenisation and end up
    with a slightly different notion of "same keyword" than the fit report.
    """

    return _terms(value)


def readable_terms(
    value: str,
    terms: set[str],
    limit: int = _DISPLAY_LIMIT,
    *,
    avoid: set[str] | None = None,
) -> list[str]:
    """Terms as the text spells them, for a response a human reads.

    ``avoid`` names the terms the caller already matched, so a gap does not
    begin or end on a character those words own.
    """

    return _display_terms(value, terms, limit, avoid)


class CareerAnalystAgent:
    """Score a posting against a profile, and say why.

    The scoring itself lives in ``scoring``; this class is only the stage
    boundary the orchestrator knows about. The import is deferred on purpose:
    ``scoring`` reads the term helpers from this module, so importing it at
    module scope would make the two files circular.
    """

    name = "career_analyst"

    def run(
        self,
        profile: ProfileInput,
        job: JobInput,
        requirements: JobRequirementSet | None = None,
    ) -> FitReport:
        from .scoring import score_fit

        return score_fit(profile, job, requirements)

