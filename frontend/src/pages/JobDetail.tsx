import { useEffect, useState } from "react";
import Top from "../components/Top";
import Band from "../components/Band";
import { useProfile } from "../store";
import { ApiError, getJob, matchJob, type JobMatch } from "../api";
import { matchColumns, requirementStatusLabel, toJobView, type JobView } from "../jobs";
import { ensureBackendProfile } from "../profileSync";
import type { Route } from "../App";

type Props = {
  go: (r: Route) => void;
  jobId: string;
};

type Status = "loading" | "ready" | "error";

const SOURCE_TEXT: Record<JobMatch["score_source"], string> = {
  extracted: "模型读了 JD 的要求",
  heuristic: "按标点切分的要求（未用模型）",
};

export default function JobDetail({ go, jobId }: Props) {
  const { profile, patch, compare, toggleCompare } = useProfile();
  const [job, setJob] = useState<JobView | null>(null);
  const [match, setMatch] = useState<JobMatch | null>(null);
  const [constraint, setConstraint] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);
    setConstraint(null);
    setMatch(null);

    if (!jobId) {
      setStatus("error");
      setError("还没有选岗位：先回名录点一个岗位，再看它的匹配依据。");
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const raw = await getJob(jobId);
        if (cancelled) return;
        setJob(toJobView(raw));

        if (profile.backendUserId) {
          const profileId = await ensureBackendProfile(profile, patch);
          if (cancelled) return;
          try {
            const result = await matchJob(profileId, jobId);
            if (!cancelled) setMatch(result);
          } catch (err) {
            // 422 = 硬性条件被确定性规则挡下，不是故障，照实说差在哪
            if (err instanceof ApiError && err.status === 422) {
              if (!cancelled) setConstraint(err.message);
            } else {
              throw err;
            }
          }
        }

        if (!cancelled) setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : (err as Error).message);
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, profile.backendUserId, profile.target.role, profile.target.city, attempt]);

  const cols = match ? matchColumns(match) : null;
  const inCompare = compare.includes(jobId);

  const verdict = constraint
    ? "硬性条件没过，看下面差在哪"
    : !match
      ? profile.backendUserId
        ? "正在计算匹配"
        : "登录并上传简历后才有匹配依据"
      : cols && cols.fail.length
        ? "硬性条件没过，先看差在哪"
        : cols && cols.gap.length
          ? "硬性条件全过，还缺一条证据"
          : "全部对上，可以直接投";

  const hardRows = match ? match.breakdown.filter((item) => item.kind === "must") : [];

  // 有逐条拆解就用拆解结果；没有就退回岗位原文，绝不自己编一列判定
  const hardTags: { key: string; label: string; ok: boolean | null }[] = hardRows.length
    ? hardRows.map((item) => ({
        key: item.requirement_id,
        label: item.text,
        ok: item.status === "covered",
      }))
    : (job?.requirements ?? [])
        .slice(0, 5)
        .map((label) => ({ key: label, label, ok: null }));

  return (
    <div className="shell" id="main">
      <Top onHome={() => go("home")} back={{ label: "返回名录", onClick: () => go("jobs") }} />

      <main className="page">
        {status === "error" && (
          <div className="panel">
            <div className="eyebrow">岗位</div>
            <p className="h3 mt-8">{error}</p>
            <div className="row wrap mt-24" style={{ gap: 10 }}>
              <button className="pill solid" type="button" onClick={() => setAttempt((n) => n + 1)}>
                重试
              </button>
              <button className="pill" type="button" onClick={() => go("jobs")}>
                返回名录
              </button>
            </div>
          </div>
        )}

        {status !== "error" && !job && (
          <div className="panel">
            <div className="eyebrow">岗位</div>
            <p className="h3 mt-8">正在读取岗位……</p>
          </div>
        )}

        {job && (
          <>
            <div className="row between wrap" style={{ gap: 16 }}>
              <div>
                <div className="eyebrow">
                  {job.company} · {job.title}
                </div>
                <h1 className="h1 mt-16">
                  {job.company} · {job.title}
                </h1>
              </div>
              <div className="row" style={{ gap: 8, alignSelf: "flex-end" }}>
                <i
                  className={
                    job.verify === "ok" ? "dot" : job.verify === "dead" ? "dot dead" : "dot hollow"
                  }
                />
                <span className="fs-13 muted">
                  {job.verify === "ok"
                    ? "已核验 · 仍在招"
                    : job.verify === "dead"
                      ? "来源失效 · 已关闭"
                      : "待核验 · 未回访"}
                </span>
              </div>
            </div>

            <p className="lead">
              {job.city} · {job.salary} · {job.employment} · {job.source} · 采集于 {job.collected}
              {job.sourceUrl && (
                <>
                  {" · "}
                  <a href={job.sourceUrl} target="_blank" rel="noreferrer">
                    原始页面
                  </a>
                </>
              )}
            </p>

            <div className="verdict mt-32">
              <div className="v-num num">{cols ? cols.score : "—"}</div>
              <div className="v-txt">
                <div className="eyebrow">匹配</div>
                <p className="mt-8">{verdict}</p>
                <div className="fit-status fs-13 mt-8">
                  {status === "loading" && "正在调用后端 /job-matches……"}
                  {status === "ready" && match && `来自后端 /api/v1/job-matches · ${SOURCE_TEXT[match.score_source]}`}
                  {status === "ready" && !match && !constraint && "暂无匹配结果"}
                  {constraint && `硬性条件被拒：${constraint}`}
                </div>
                {error && <div className="fit-status fs-13 mt-8">{error}</div>}
              </div>
              {status === "error" && (
                <button
                  className="pill sm"
                  style={{ marginLeft: "auto" }}
                  type="button"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  重试
                </button>
              )}
            </div>

            <div className="reqs mt-24">
              {hardTags.map((item) => (
                <span
                  key={item.key}
                  className={item.ok === null ? "tag mute" : item.ok ? "tag" : "tag red"}
                >
                  {item.ok === null ? "·" : item.ok ? "✓" : "✕"} {item.label}
                </span>
              ))}
            </div>

            <div className="grid3 mt-32">
              <div className="col-list">
                <h4>满足 · {cols?.met.length ?? 0}</h4>
                <ul>
                  {(cols?.met ?? []).map((x) => (
                    <li key={x}>
                      <em>✓</em>
                      {x}
                    </li>
                  ))}
                  {!cols?.met.length && (
                    <li>
                      <em>·</em>
                      {profile.backendUserId ? "还没有命中的要求" : "登录后才有命中清单"}
                    </li>
                  )}
                </ul>
              </div>
              <div className="col-list">
                <h4>缺证据 · {cols?.gap.length ?? 0}</h4>
                <ul>
                  {cols?.gap.length ? (
                    cols.gap.map((x) => (
                      <li key={x}>
                        <em>?</em>
                        {x}（档案里没写）
                      </li>
                    ))
                  ) : (
                    <li>
                      <em>·</em>
                      没有缺口
                    </li>
                  )}
                </ul>
              </div>
              <div className="col-list">
                <h4>不满足 · {cols?.fail.length ?? 0}</h4>
                <ul>
                  {cols?.fail.length ? (
                    cols.fail.map((x) => (
                      <li key={x}>
                        <em>✕</em>
                        {x}
                      </li>
                    ))
                  ) : (
                    <li>
                      <em>·</em>
                      硬性条件全部满足
                    </li>
                  )}
                </ul>
              </div>
            </div>

            {match && (
              <div className="panel mt-24">
                <div className="eyebrow">
                  匹配依据 · 置信度 {Math.round(match.confidence * 100)}% · 硬性覆盖{" "}
                  {Math.round(match.must_coverage * 100)}%
                </div>
                <p className="mt-8" style={{ fontSize: 15 }}>
                  {match.recommendation || "后端没有给出额外建议。"}
                </p>
                {match.breakdown.length > 0 && (
                  <ul className="mt-16">
                    {match.breakdown.slice(0, 8).map((item) => (
                      <li key={item.requirement_id} className="small">
                        <b>{requirementStatusLabel(item.status)}</b> · {item.text}
                        {item.missing_terms.length > 0 && (
                          <span className="muted">（缺 {item.missing_terms.join("、")}）</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {match.unknowns.length > 0 && (
                  <p className="small mt-8">
                    无法判断 · {match.unknowns.join("；")}
                  </p>
                )}
              </div>
            )}

            {!profile.backendUserId && (
              <div className="panel y mt-24">
                <div className="eyebrow">还没有匹配分</div>
                <p className="small mt-8">
                  匹配分由后端按你的画像逐条对照岗位要求算出来。先登录、上传简历，
                  再回来看这一页。
                </p>
                <div className="row wrap mt-16" style={{ gap: 10 }}>
                  <button className="pill solid" type="button" onClick={() => go("upload")}>
                    去上传简历
                  </button>
                  <button className="pill" type="button" onClick={() => go("home")}>
                    回主页登录
                  </button>
                </div>
              </div>
            )}

            <div className="grid3 mt-32">
              <div className="col-list">
                <h4>下一步 · 简历强调</h4>
                <p style={{ fontSize: 14 }}>
                  {cols?.met.length
                    ? cols.met.slice(0, 3).join("、")
                    : "先把项目经历和技能证据补上"}
                </p>
              </div>
              <div className="col-list">
                <h4>下一步 · 面试准备</h4>
                <p style={{ fontSize: 14 }}>
                  {cols?.gap.length
                    ? `大概率会追问：${cols.gap.slice(0, 3).join("、")}`
                    : "按岗位要求逐条准备即可"}
                </p>
              </div>
              <div className="col-list">
                <h4>下一步 · 去补充</h4>
                <p style={{ fontSize: 14 }}>
                  {cols?.fail.length || cols?.gap.length
                    ? [...(cols?.fail ?? []), ...(cols?.gap ?? [])].slice(0, 2).join("、")
                    : "暂时没有明显缺口"}
                </p>
              </div>
            </div>

            <div className="row wrap mt-32" style={{ gap: 10 }}>
              <button className="pill solid" onClick={() => go("resume-draft")} type="button">
                生成定制简历
              </button>
              <button className="pill" onClick={() => toggleCompare(job.id)} type="button">
                {inCompare ? "已加入对比" : "加入对比"}
              </button>
              <button className="pill" onClick={() => go("interview")} type="button">
                面这个
              </button>
              <button className="pill" onClick={() => go("jobs")} type="button">
                不考虑
              </button>
            </div>
          </>
        )}
      </main>

      <Band
        step={2}
        total={4}
        label={job ? `只看这一个 · ${job.company}` : "岗位详情"}
        action={{ label: "去模拟面试 →", onClick: () => go("interview") }}
      />
    </div>
  );
}
