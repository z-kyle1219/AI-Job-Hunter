import { useEffect, useState } from "react";
import Top from "../components/Top";
import Band from "../components/Band";
import { useProfile } from "../store";
import { ApiError, getJob, matchJob, type JobMatch } from "../api";
import { matchColumns, toJobView, type JobView } from "../jobs";
import { ensureBackendProfile } from "../profileSync";
import type { Route } from "../App";

type Props = {
  go: (r: Route) => void;
};

type Picked = { job: JobView; match: JobMatch | null };

export default function Compare({ go }: Props) {
  const { profile, patch, compare, toggleCompare } = useProfile();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const key = compare.join(",");

  useEffect(() => {
    if (!compare.length) {
      setPicked([]);
      setStatus("ready");
      setError(null);
      return;
    }

    let cancelled = false;
    setStatus("loading");
    setError(null);

    void (async () => {
      try {
        const rows = await Promise.all(compare.map((id) => getJob(id)));
        const views = rows.map(toJobView);
        let matches: (JobMatch | null)[] = views.map(() => null);

        if (profile.backendUserId) {
          const profileId = await ensureBackendProfile(profile, patch);
          matches = await Promise.all(
            views.map((view) =>
              matchJob(profileId, view.id).catch((err: unknown) => {
                // 422 = 硬性条件被拒：这一格没有分数，但对比仍然成立
                if (err instanceof ApiError && err.status === 422) return null;
                throw err;
              })
            )
          );
        }

        if (cancelled) return;
        setPicked(views.map((job, i) => ({ job, match: matches[i] })));
        setStatus("ready");
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
  }, [key, profile.backendUserId]);

  const sorted = [...picked].sort((a, b) => {
    const score = (item: Picked) => (item.match ? item.match.score : -1);
    return score(b) - score(a);
  });

  const ranked = sorted.filter(
    (item): item is Picked & { match: JobMatch } => item.match !== null
  );
  const lead = ranked[0] ?? null;

  return (
    <div className="shell" id="main">
      <Top onHome={() => go("home")} back={{ label: "返回结果列表", onClick: () => go("jobs") }} />

      <main className="page">
        <div className="eyebrow">B 区 · 岗位对比</div>
        <h1 className="h1 mt-16">岗位对比</h1>
        <p className="lead">
          {sorted.length ? `并排比较 ${sorted.length} 个岗位，最多 4 个。` : "还没有选岗位。"}
        </p>

        {sorted.length > 0 && (
          <p className="small mt-8">
            {status === "loading" && "正在向后端逐条核对匹配……"}
            {status === "ready" && "匹配分来自后端 /api/v1/job-matches"}
            {status === "error" && `核对失败：${error}`}
          </p>
        )}

        {sorted.length === 0 ? (
          <div className="panel mt-32">
            <div className="eyebrow">对比 · 0 / 4</div>
            <p className="lead">
              去岗位详情里点「加入对比」，选满 2 个就能在这里并排看。
            </p>
            <button className="pill solid mt-24" onClick={() => go("jobs")} type="button">
              去看岗位
            </button>
          </div>
        ) : (
          <>
            <div className="row wrap mt-32" style={{ gap: 16, alignItems: "stretch" }}>
              {sorted.map(({ job, match }, i) => {
                const cols = match ? matchColumns(match) : null;
                return (
                  <div
                    key={job.id}
                    style={{
                      flex: "1 1 260px",
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <div
                      className={i === 0 ? "panel y" : "panel"}
                      style={{ padding: "18px 18px 16px" }}
                    >
                      <div
                        className="row between"
                        style={{ gap: 8, alignItems: "flex-start" }}
                      >
                        {i === 0 ? (
                          <span className="tag">推荐</span>
                        ) : (
                          <span className="eyebrow">{String(i + 1).padStart(2, "0")}</span>
                        )}
                        <button
                          className="pill sm"
                          onClick={() => {
                            toggleCompare(job.id);
                          }}
                          type="button"
                        >
                          移除
                        </button>
                      </div>
                      <div className="h2 mt-16">{job.company}</div>
                      <div className="small">{job.title}</div>
                    </div>

                    <div
                      style={{
                        flex: "1 1 auto",
                        borderLeft: "1.5px solid var(--ink)",
                        borderRight: "1.5px solid var(--ink)",
                        borderBottom: "1.5px solid var(--ink)",
                      }}
                    >
                      <div style={{ padding: "13px 18px", minHeight: 76 }}>
                        <div className="eyebrow">匹配分</div>
                        <div className="num mt-8" style={{ fontSize: 32, lineHeight: 1 }}>
                          {cols ? cols.score : "—"}
                        </div>
                      </div>

                      <div
                        style={{
                          padding: "13px 18px",
                          minHeight: 76,
                          borderTop: "1px solid var(--line)",
                        }}
                      >
                        <div className="eyebrow">薪资</div>
                        <div className="mt-8">{job.salary}</div>
                      </div>

                      <div
                        style={{
                          padding: "13px 18px",
                          minHeight: 76,
                          borderTop: "1px solid var(--line)",
                        }}
                      >
                        <div className="eyebrow">城市</div>
                        <div className="mt-8">{job.city}</div>
                      </div>

                      <div
                        style={{
                          padding: "13px 18px",
                          minHeight: 76,
                          borderTop: "1px solid var(--line)",
                        }}
                      >
                        <div className="eyebrow">类型</div>
                        <div className="mt-8">{job.employment}</div>
                      </div>

                      <div
                        style={{
                          padding: "13px 18px",
                          minHeight: 76,
                          borderTop: "1px solid var(--line)",
                        }}
                      >
                        <div className="eyebrow">核验</div>
                        <div className="row mt-8" style={{ gap: 8 }}>
                          <i
                            className={
                              job.verify === "ok"
                                ? "dot"
                                : job.verify === "dead"
                                  ? "dot dead"
                                  : "dot hollow"
                            }
                          />
                          <span className="fs-13">
                            {job.verify === "ok"
                              ? "已核验"
                              : job.verify === "dead"
                                ? "来源失效"
                                : "待核验"}
                          </span>
                        </div>
                      </div>

                      <div
                        style={{
                          padding: "13px 18px",
                          minHeight: 76,
                          borderTop: "1px solid var(--line)",
                        }}
                      >
                        <div className="eyebrow">缺口</div>
                        <div className="mt-8">
                          {!cols
                            ? "无匹配结果"
                            : cols.gap.length + cols.fail.length === 0
                              ? "无"
                              : `${cols.gap.length + cols.fail.length} 项`}
                        </div>
                      </div>

                      <div
                        style={{
                          padding: "13px 18px",
                          minHeight: 76,
                          borderTop: "1px solid var(--line)",
                        }}
                      >
                        <div className="eyebrow">下一步</div>
                        <button
                          className="pill sm mt-8"
                          onClick={() => go("interview")}
                          type="button"
                        >
                          面这个
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {sorted.length >= 2 && lead && (
              <p className="small mt-24">
                推荐顺序：{sorted.map((item) => item.job.company).join(" > ")}。
                {lead.job.company} 的匹配分最高（{matchColumns(lead.match).score} 分，硬性覆盖{" "}
                {Math.round(lead.match.must_coverage * 100)}%）；后面的岗位各有缺口，需要先补证据。
              </p>
            )}
          </>
        )}
      </main>

      <Band
        step={2}
        total={4}
        label={`岗位对比 · ${sorted.length} / 4 个`}
        action={sorted.length ? { label: "继续挑岗位", onClick: () => go("jobs") } : undefined}
      />
    </div>
  );
}
