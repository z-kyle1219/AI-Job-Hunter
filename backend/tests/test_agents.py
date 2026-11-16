from __future__ import annotations

import unittest

from backend.app.agents import CareerAnalystAgent
from backend.app.schemas import JobInput, ProfileInput


def _job(requirements: str) -> JobInput:
    return JobInput(
        title="算法实习生",
        company="示例科技",
        description="负责模型迭代与效果跟踪",
        requirements=requirements,
        employment_type="internship",
        source_name="manual",
    )


def _profile(**overrides: object) -> ProfileInput:
    values: dict[str, object] = {
        "summary": "计算机专业学生，熟悉机器学习与数据分析",
        "skills": ["机器学习", "数据分析", "Python"],
        "experiences": ["用 Python 完成数据清洗与建模"],
    }
    values.update(overrides)
    return ProfileInput(**values)


class ChineseKeywordMatchingTest(unittest.TestCase):
    def test_chinese_requirements_produce_a_real_score(self) -> None:
        report = CareerAnalystAgent().run(
            _profile(),
            _job("熟悉机器学习、数据分析；有 Python 项目经验；了解 SQL"),
        )

        self.assertGreater(report.score, 0.3)
        self.assertLessEqual(report.score, 1.0)
        self.assertIn("机器学习", report.match_points)
        self.assertIn("数据分析", report.match_points)
        self.assertIn("python", report.match_points)
        self.assertIn("sql", report.gaps)
        self.assertGreater(report.confidence, 0.0)
        self.assertNotIn("All explicit job keywords are covered", report.recommendation)

    def test_report_does_not_pretend_unparsed_requirements_are_covered(self) -> None:
        report = CareerAnalystAgent().run(_profile(), _job("???"))

        self.assertEqual(report.score, 0.0)
        self.assertEqual(report.confidence, 0.0)
        self.assertEqual(report.match_points, [])
        self.assertEqual(report.gaps, [])
        self.assertIn("could not run", report.summary)

    def test_profile_without_comparable_terms_is_reported_as_unmeasured(self) -> None:
        report = CareerAnalystAgent().run(
            _profile(summary="了解", skills=[], experiences=[]),
            _job("熟悉机器学习"),
        )

        self.assertEqual(report.score, 0.0)
        self.assertEqual(report.confidence, 0.0)
        self.assertIn("could not run", report.summary)

    def test_real_gaps_are_named_without_filler_words(self) -> None:
        report = CareerAnalystAgent().run(
            _profile(summary="市场专业学生", skills=["用户调研"], experiences=[]),
            _job("精通 C++ 与嵌入式开发"),
        )

        self.assertEqual(report.score, 0.0)
        # A measured zero is not an unmeasured one: the requirement was read and
        # met by nothing, so confidence is high rather than absent.
        self.assertEqual(report.confidence, 0.8)
        self.assertIn("嵌入式开发", report.gaps)
        self.assertNotIn("熟悉", report.gaps)
        self.assertTrue(
            report.recommendation.startswith("Prioritize quantified evidence")
        )

    def test_ascii_only_requirement_keeps_its_score(self) -> None:
        report = CareerAnalystAgent().run(
            ProfileInput(summary="Python student", skills=["Python"]),
            _job("Python"),
        )

        self.assertEqual(report.score, 1.0)
        self.assertEqual(report.match_points, ["python"])
        self.assertEqual(report.gaps, [])
        self.assertEqual(report.confidence, 0.8)
        self.assertEqual(report.score_source, "heuristic")
        self.assertEqual([entry.status for entry in report.breakdown], ["covered"])

    def test_gap_does_not_claim_a_character_from_a_matched_word(self) -> None:
        # 推荐系统 is matched, so the unmatched 统经/经验 pair used to merge back
        # into 统经验: a gap that starts on a character 系统 already accounts
        # for. The reported gap must be 经验.
        report = CareerAnalystAgent().run(
            _profile(summary="推荐系统", skills=["推荐系统"], experiences=[]),
            _job("熟悉推荐系统经验"),
        )

        self.assertEqual(report.match_points, ["推荐系统"])
        self.assertEqual(report.gaps, ["经验"])

    def test_partial_gap_stops_at_the_matched_boundary(self) -> None:
        # The mirror case: 分布式系统 scored against 系统 is a partial, and the
        # gap is 分布式 rather than the 分布式系 a blind bigram merge produces.
        report = CareerAnalystAgent().run(
            _profile(summary="系统", skills=["系统"], experiences=[]),
            _job("熟悉分布式系统"),
        )

        self.assertEqual(report.match_points, ["系统"])
        self.assertEqual(report.gaps, ["分布式"])
        self.assertEqual(report.breakdown[0].status, "partial")


if __name__ == "__main__":
    unittest.main()
