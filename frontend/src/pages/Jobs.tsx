import { useEffect, useMemo, useState } from "react";
import Top from "../components/Top";
import Band from "../components/Band";
import { useProfile } from "../store";
import {
  ApiError,
  collectJobs,
  employmentTypeOf,
  listJobs,
  searchJobs,
  type JobCandidate,
  type JobSearchResult,
} from "../api";
import {
  EMPLOYMENT_OPTIONS,
  candidateScore,
  toJobView,
  type JobView,
  type Verify,
} from "../jobs";
import { ensureBackendProfile } from "../profileSync";
import type { Employment } from "../types";
import type { Route } from "../App";

type Props = {
  go: (r: Route) => void;
  onPick: (id: string) => void;
};

type ApiState = "loading" | "ready" | "error";

type Row = { job: JobView; candidate: JobCandidate | null };

const VERIFY_TEXT: Record<Verify, string> = {
  ok: "已核验 · 仍在招",
  pending: "待核验 · 未回访",
  dead: "来源失效 · 已关闭",
};

function errText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : "请求失败";
}

export default function Jobs({ go, onPick }: Props) {
  const { profile, patch, compare } = useProfile();
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState(profile.target.role ?? "");
  const [city, setCity] = useState(profile.target.city ?? "");
  const [emp, setEmp] = useState<Employment>(profile.target.employment ?? "实习");

  const [jobs, setJobs] = useState<JobView[]>([]);
  const [search, setSearch] = useState<JobSearchResult | null>(null);
  const [state, setState] = useState<ApiState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setError(null);

    void (async () => {
      try {
        const stored = await listJobs();
        if (cancelled) return;
        setJobs(stored.map(toJobView));

        if (!profile.backendUserId) {
          setSearch(null);
          setState("ready");
          return;
        }

        const profileId = await ensureBackendProfile(profile, patch);
        if (cancelled) return;

        const result = await searchJobs({
          profile_id: profileId,
          query: {
            role: profile.target.role ?? "",
            keywords: profile.skills ?? [],
            locations: profile.target.city ? [profile.target.city] : [],
            employment_type: employmentTypeOf(profile.target.employment),
            limit: 20,
          },
        });
        if (cancelled) return;
        setSearch(result);
        setState("ready");
      } catch (err) {
        if (cancelled) return;
        setError(errText(err));
        setState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    profile.backendUserId,
    profile.target.role,
    profile.target.city,
    profile.target.employment,
    attempt,
  ]);

  const rows = useMemo<Row[]>(() => {
    const tier = (job: JobView) => (job.verify === "dead" ? 1 : 0);

    if (search) {
      const byId = new Map(jobs.map((job) => [job.id, job]));
      const matched: Row[] = [];
      for (const candidate of search.candidates) {
        const view = byId.get(candidate.job_id);
        if (view) matched.push({ job: view, candidate });
      }
      const shown = new Set(matched.map((row) => row.job.id));
      const rest: Row[] = jobs
        .filter((job) => !shown.has(job.id))
        .map((job) => ({ job, candidate: null }));
      return [...matched, ...rest].sort(
        (a, b) => tier(a.job) - tier(b.job) || (b.candidate?.score ?? 0) - (a.candidate?.score ?? 0)
      );
    }

    return jobs.map((job) => ({ job, candidate: null })).sort((a, b) => tier(a.job) - tier(b.job));
  }, [jobs, search]);

  const verified = rows.filter((row) => row.job.verify === "ok").length;
  const hasTarget = !!(profile.target.city || profile.target.role);

  function save() {
    patch({
      target: {
        role: role.trim() || undefined,
        city: city.trim() || undefined,
        employment: emp,
      },
    });
    setEditing(false);
  }

  async function collect() {
    setCollecting(true);
    setNotice(null);
    try {
      const result = await collectJobs(20);
      setNotice(
        `采集完成：来源 ${result.source}，抓取 ${result.fetched} 条，新增 ${result.created.length} 条，更新 ${result.updated.length} 条。`
      );
      setAttempt((n) => n + 1);
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 503
          ? `来源没有配置（503）：${err.message}`
          : err instanceof ApiError && err.status === 502
            ? `来源暂时不可达（502）：${err.message}`
            : `采集失败：${errText(err)}`;
      setNotice(message);
    } finally {
      setCollecting(false);
    }
  }

  return (
    <div className="shell" id="main">
      <Top onHome={() => go("home")} back={{ label: "返回主页", onClick: () => go("home") }} />

      <main className="page">
        <div className="eyebrow">B 区 · 岗位</div>
        <h1 className="h1 mt-16">哪个值得投？</h1>
        <p className="lead">
          点进去看它为什么匹配，不只是给一个分。失效的岗位会留在名录里，划掉，但不抹掉。
        </p>

        <div className="row between wrap mt-24" style={{ gap: 12 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="tag">{profile.target.role ?? "方向待设定"}</span>
            <span className="tag">{profile.target.city ?? "不限城市"}</span>
            <span className="tag">{profile.target.employment ?? "不限类型"}</span>
            {search && <span className="tag mute">{search.candidates.length} 条入选</span>}
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <button
              className="pill sm"
              type="button"
              disabled={collecting}
              onClick={() => void collect()}
            >
              {collecting ? "采集中……" : "从来源采集"}
            </button>
            <button className="pill sm" type="button" onClick={() => setEditing((v) => !v)}>
              {editing ? "收起" : hasTarget ? "修改条件" : "设定条件"}
            </button>
          </div>
        </div>

        {editing && (
          <div className="panel mt-16">
            <div className="row wrap" style={{ gap: 16, alignItems: "flex-end" }}>
              <label className="field" style={{ flex: "1 1 200px", marginTop: 0 }}>
                <span>岗位方向</span>
                <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="前端开发" />
              </label>
              <label className="field" style={{ flex: "1 1 160px", marginTop: 0 }}>
                <span>城市</span>
                <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="上海" />
              </label>
              <label className="field" style={{ flex: "1 1 140px", marginTop: 0 }}>
                <span>类型</span>
                <select
                  value={emp}
                  onChange={(e) => setEmp(e.target.value as Employment)}
                >
                  {EMPLOYMENT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.label}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="pill solid" onClick={save} type="button">
                保存
              </button>
            </div>
          </div>
        )}

        <div className="row between wrap mt-24" style={{ gap: 12 }}>
          <span className="fs-13 muted">
            <b className="mono" style={{ fontSize: 18, color: "var(--ink)" }}>
              {verified}
            </b>{" "}
            已核验 / {rows.length} 全部 · 有效优先
          </span>
          <span className="fs-11 muted" style={{ letterSpacing: ".12em" }}>
            {state === "loading" && "正在读取岗位库……"}
            {state === "ready" &&
              (search
                ? `检索扫描 ${search.total_scanned} 条 · 排除 ${search.excluded.length} 条`
                : "岗位库直出 · 登录并上传简历后可算匹配分")}
            {state === "error" && "岗位库读取失败"}
          </span>
          {state === "error" && (
            <button className="pill sm" type="button" onClick={() => setAttempt((n) => n + 1)}>
              重试
            </button>
          )}
        </div>

        {notice && <p className="small mt-8">{notice}</p>}
        {error && (
          <p className="small warn mt-8" role="alert">
            {error}
          </p>
        )}
        {!profile.backendUserId && (
          <p className="small mt-8">
            当前未登录：这里显示的是岗位库原样列表，没有匹配分。登录并上传简历后会逐条打分。
          </p>
        )}

        {state === "ready" && rows.length === 0 ? (
          <div className="panel mt-24">
            <div className="eyebrow">岗位库 · 0 条</div>
            <p className="h3 mt-8">还没有可推荐的岗位</p>
            <p className="small mt-8">
              一是来源没采集过；二是检索条件把库里的岗位都排除了。先点上方「从来源采集」，
              或者放宽城市 / 类型再试。
            </p>
            {search && search.excluded.length > 0 && (
              <ul className="mt-16">
                {search.excluded.slice(0, 4).map((item) => (
                  <li key={item.job_id} className="small">
                    {item.company} · {item.title} —— {item.reasons.join("；")}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="jlist mt-16">
            {rows.map(({ job, candidate }) => {
              const score = candidateScore(candidate);
              return (
                <button
                  key={job.id}
                  className={job.verify === "dead" ? "jrow dead" : "jrow"}
                  onClick={() => onPick(job.id)}
                  type="button"
                >
                  <span className="j-main">
                    <span className="j-title">
                      {job.company} · {job.title}
                    </span>
                    <span className="j-sub">
                      {job.city} · {job.salary} · {job.employment}
                    </span>
                    <span className="j-src">
                      <i
                        className={
                          job.verify === "ok"
                            ? "dot"
                            : job.verify === "dead"
                              ? "dot dead"
                              : "dot hollow"
                        }
                      />
                      {VERIFY_TEXT[job.verify]} · {job.source} · 采集于 {job.collected}
                    </span>
                    {candidate && candidate.reason && (
                      <span className="j-sub">{candidate.reason}</span>
                    )}
                    {candidate && candidate.missing.length > 0 && (
                      <span className="j-src">缺口 · {candidate.missing.slice(0, 4).join("、")}</span>
                    )}
                  </span>
                  <span className="j-score num">{score ?? "—"}</span>
                  <span className="j-arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <p className="small mt-24">
          「缺证据」不等于「不满足」：前者是你没写，后者是岗位不让。点进详情分得清。
        </p>
      </main>

      <Band
        step={2}
        total={4}
        label={`岗位 · 已核验 ${verified} 个`}
        action={
          compare.length >= 2
            ? { label: `去对比（${compare.length}）`, onClick: () => go("compare") }
            : rows.length
              ? { label: "先看一个岗位", onClick: () => onPick(rows[0].job.id) }
              : undefined
        }
      />
    </div>
  );
}
