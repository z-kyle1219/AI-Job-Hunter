from __future__ import annotations

import time

from sqlalchemy.orm import Session

from .llm import LLMClient
from .schemas import RunEvent
from .schemas_hunt import JobHuntRequest, JobHuntResponse, JobHuntSkip
from .schemas_resources import JobMatchCreate, JobMatchRead
from .schemas_search import JobSearchRequest
from .scoring import rank_key
from .services import (
    ConstraintRejectedError,
    NotFoundError,
    create_job_match,
    draft_resume_for_profile,
    get_profile,
    search_jobs,
)


def _stage(name: str, started: float, detail: str) -> RunEvent:
    """A completed stage, timed. Failures propagate instead of being logged.

    A failure here is either a 4xx the caller already understands or a bug; in
    both cases returning a half-filled pipeline would be worse than raising.
    """

    return RunEvent(
        stage=name,
        status="ok",
        duration_ms=int((time.perf_counter() - started) * 1000),
        detail=detail,
    )


class JobHuntOrchestrator:
    """Search → match → optional base resume, in one request.

    Nothing new is computed here: every stage is an existing service. The value
    is that the output of one stage is exactly the input of the next, and that
    the two constraint sets are allowed to disagree. Search filters by the
    query, matching filters by the profile's hard constraints, so a candidate
    that survives search can still be refused by matching; that refusal is
    reported per job in ``skipped`` instead of failing the run or vanishing.

    ``client`` serves the optional model steps: the resume draft, and the query
    expansion a request can ask for. Passing ``None`` keeps the pipeline
    runnable on a deployment without a model key; asking for a resume in that
    state fails loudly rather than returning a silently empty ``resume``, while
    expansion just records that it was skipped.
    """

    def __init__(self, client: LLMClient | None = None) -> None:
        self.client = client

    def run(self, session: Session, request: JobHuntRequest) -> JobHuntResponse:
        events: list[RunEvent] = []
        notes: list[str] = []

        started = time.perf_counter()
        search = search_jobs(
            session,
            JobSearchRequest(query=request.query, profile_id=request.profile_id),
            client=self.client,
        )
        events.append(_stage("job_hunter", started, f"{len(search.candidates)} 个候选"))
        notes.extend(search.notes)

        started = time.perf_counter()
        matches: list[JobMatchRead] = []
        skipped: list[JobHuntSkip] = []
        for candidate in search.candidates[: request.match_top]:
            try:
                match = create_job_match(
                    session,
                    JobMatchCreate(
                        user_profile_id=request.profile_id,
                        job_id=candidate.job_id,
                    ),
                    self.client,
                )
            except ConstraintRejectedError as exc:
                skipped.append(
                    JobHuntSkip(
                        job_id=candidate.job_id,
                        title=candidate.title,
                        reasons=[*exc.outcome.rejections, *exc.outcome.unknowns],
                    )
                )
                continue
            except NotFoundError:
                # The job disappeared between the search and this loop.
                skipped.append(
                    JobHuntSkip(
                        job_id=candidate.job_id,
                        title=candidate.title,
                        reasons=["岗位在检索之后被移除"],
                    )
                )
                continue
            matches.append(JobMatchRead.model_validate(match))

        # Best fit first. Candidates arrive in search order, which answers the
        # query and says nothing about the profile, so a list of matches used to
        # be ordered by something other than the number attached to each one.
        # The tie-break only fires on an exact tie; it never lifts a lower score
        # above a higher one.
        matches.sort(key=lambda match: rank_key(match.score, match.must_coverage))

        events.append(
            _stage(
                "matching",
                started,
                f"匹配 {len(matches)} 条，跳过 {len(skipped)} 条",
            )
        )
        if skipped:
            notes.append(
                "skipped 里的候选通过了检索条件，但没过画像的硬约束："
                "检索按查询、匹配按画像，两者可以不一致。"
            )

        resume = None
        if request.with_resume:
            if self.client is None:
                raise ValueError(
                    "with_resume 需要模型客户端：调用方应先取得它，而不是生成一份空简历"
                )
            started = time.perf_counter()
            profile = get_profile(session, request.profile_id)
            resume = draft_resume_for_profile(
                session, profile, self.client, request.max_chunk_tokens
            )
            events.append(_stage("resume", started, f"degraded={resume.degraded}"))

        return JobHuntResponse(
            profile_id=request.profile_id,
            search=search,
            matches=matches,
            skipped=skipped,
            resume=resume,
            run_log=events,
            notes=notes,
        )
