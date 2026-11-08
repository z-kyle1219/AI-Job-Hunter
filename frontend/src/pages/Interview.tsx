import { useEffect, useRef, useState } from "react";
import Top from "../components/Top";
import Band from "../components/Band";
import { useProfile } from "../store";
import {
  ApiError,
  answerInterview,
  evaluateInterviewSession,
  getJob,
  listJobs,
  startInterview,
  type InterviewEvaluation,
  type InterviewSession,
} from "../api";
import { toJobView, type JobView } from "../jobs";
import { ensureBackendProfile } from "../profileSync";
import type { Route } from "../App";

type Props = {
  go: (r: Route) => void;
  jobId: string;
};

type State = "idle" | "starting" | "ready" | "sending" | "done" | "error";

function mmss(total: number) {
  const m = Math.floor(total / 60);
  const r = total % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function explain(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 503) return "后端没有配置模型 Key（503），出题和追问都停在模型这一步。";
    if (err.status === 422) return `这个岗位没法出题：${err.message}`;
    if (err.status === 409) return err.message;
    return err.message;
  }
  return err instanceof Error ? err.message : "请求失败";
}

export default function Interview({ go, jobId }: Props) {
  const { profile, patch, setInterview, setEvaluation } = useProfile();
  const [job, setJob] = useState<JobView | null>(null);
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [seconds, setSeconds] = useState(0);
  const started = useRef(false);

  const running = state === "ready" || state === "sending";

  useEffect(() => {
    if (jobId) {
      void getJob(jobId)
        .then((raw) => setJob(toJobView(raw)))
        .catch(() => setJob(null));
      return;
    }
    // 从主页直接进来时没有岗位 id：默认拿岗位库里第一个还活着的
    void listJobs()
      .then((rows) => {
        const views = rows.map(toJobView);
        setJob(views.find((view) => view.verify !== "dead") ?? views[0] ?? null);
      })
      .catch(() => setJob(null));
  }, [jobId]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  async function start() {
    const targetJobId = jobId || job?.id;
    if (!targetJobId) {
      setError("岗位库里还没有岗位：先去岗位页采集或选一个岗位。");
      setState("error");
      return;
    }

    setState("starting");
    setError(null);
    setSeconds(0);
    // 新的一场面试：上一场的复盘不能留在报告页冒充这一场的结果
    setEvaluation(null);
    setInterview(null);
    try {
      const profileId = await ensureBackendProfile(profile, patch);
      const created = await startInterview(profileId, targetJobId, 8);
      setSession(created);
      setState("ready");
      started.current = true;
    } catch (err) {
      setError(explain(err));
      setState("error");
    }
  }

  async function finish(finished: InterviewSession) {
    const answers = finished.turns
      .filter((turn) => turn.answer !== null)
      .map((turn) => ({
        id: turn.requirement_id,
        point: turn.requirement_text || "考察点",
        text: turn.answer ?? "",
      }));

    setInterview({
      jobId: finished.job_id,
      jobTitle: job?.title,
      company: job?.company,
      sessionId: finished.id,
      answers,
      seconds,
    });

    try {
      const review: InterviewEvaluation = await evaluateInterviewSession(finished.id, false);
      setEvaluation(review);
      setInterview({
        jobId: finished.job_id,
        jobTitle: job?.title,
        company: job?.company,
        sessionId: finished.id,
        answers,
        seconds,
        coverage: review.coverage,
        overall: review.overall,
      });
      setState("done");
      go("report");
    } catch (err) {
      setError(`面试已结束，但复盘没生成：${explain(err)}`);
      setState("done");
    }
  }

  async function submit(answerText: string) {
    if (!session) return;
    const answer = answerText.trim();
    if (!answer || state === "sending") return;

    setState("sending");
    setError(null);
    try {
      const next = await answerInterview(session.id, answer);
      setSession(next);
      setDraft("");
      if (next.status === "finished") {
        await finish(next);
      } else {
        setState("ready");
      }
    } catch (err) {
      setError(explain(err));
      setState("ready");
    }
  }

  const pendingTurn = session
    ? [...session.turns].reverse().find((turn) => turn.answer === null) ?? null
    : null;
  const answered = session ? session.turns.filter((turn) => turn.answer !== null).length : 0;
  const total = session?.max_turns ?? 8;
  const targets = session?.plan.targets ?? [];

  return (
    <div className="shell" id="main">
      <Top onHome={() => go("home")} back={{ label: "结束面试", onClick: () => go("home") }} />

      <main className="page">
        <div className="eyebrow">
          {job ? `${job.company} · ${job.title}` : "模拟面试"}
        </div>

        {!profile.backendUserId && (
          <div className="panel mt-24">
            <div className="eyebrow">还不能开始</div>
            <p className="h3 mt-8">先登录并上传一份简历</p>
            <p className="small mt-8">
              出题的依据是你的画像和这个岗位的要求：后端需要 profile_id 和 job_id 才能建一场面试。
            </p>
            <div className="row wrap mt-24" style={{ gap: 10 }}>
              <button className="pill solid" type="button" onClick={() => go("upload")}>
                去上传简历
              </button>
              <button className="pill" type="button" onClick={() => go("jobs")}>
                回岗位列表
              </button>
            </div>
          </div>
        )}

        {profile.backendUserId && !session && state !== "error" && (
          <div className="panel mt-24">
            <div className="eyebrow">准备中</div>
            <p className="h3 mt-8">
              {state === "starting" ? "正在按岗位要求出题……" : "还没开始"}
            </p>
            <p className="small mt-8">
              一场最多 {total} 题，会根据你的回答追问一层。出题需要调用模型，通常几秒。
            </p>
            {state !== "starting" && (
              <button className="pill solid mt-24" type="button" onClick={() => void start()}>
                {started.current ? "重新开始一场" : "开始面试"}
              </button>
            )}
          </div>
        )}

        {state === "error" && (
          <div className="panel mt-24">
            <div className="eyebrow">出题失败</div>
            <p className="h3 mt-8">{error}</p>
            <div className="row wrap mt-24" style={{ gap: 10 }}>
              <button className="pill solid" type="button" onClick={() => void start()}>
                重试
              </button>
              <button className="pill" type="button" onClick={() => go("jobs")}>
                换个岗位
              </button>
            </div>
          </div>
        )}

        {session && pendingTurn && (
          <>
            <div
              className="row between wrap mt-24"
              style={{ gap: 32, alignItems: "flex-end" }}
            >
              <div>
                <div className="eyebrow">
                  第 {answered + 1} 题 · 上限 {total} 题
                </div>
                <div
                  className="num mt-8"
                  style={{ fontSize: "clamp(64px, 9vw, 120px)", lineHeight: 0.8 }}
                >
                  {String(answered + 1).padStart(2, "0")}
                  <span className="muted" style={{ fontSize: "0.32em", letterSpacing: 0 }}>
                    {" "}
                    / {String(total).padStart(2, "0")}
                  </span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="eyebrow">已用时间</div>
                <div
                  className="num mt-8"
                  style={{ fontSize: "clamp(44px, 6vw, 80px)", lineHeight: 0.85 }}
                >
                  {mmss(seconds)}
                </div>
              </div>
            </div>

            <div className="row between wrap mt-16" style={{ gap: 12 }}>
              <span className="small">
                综合面试 · 模拟模式
                {pendingTurn.kind === "probe" ? " · 追问一层" : ""}
              </span>
              <span className="small">
                考察点 · {Math.min(answered, targets.length)} / {targets.length || total}
              </span>
            </div>

            <h1 className="h1 mt-48">{pendingTurn.question}</h1>

            {(pendingTurn.requirement_text || pendingTurn.why) && (
              <div className="row wrap mt-24" style={{ gap: 12, alignItems: "baseline" }}>
                {pendingTurn.requirement_text && (
                  <span className="tag">{pendingTurn.requirement_text}</span>
                )}
                {pendingTurn.why && (
                  <span className="small" style={{ maxWidth: "34em" }}>
                    {pendingTurn.why}
                  </span>
                )}
              </div>
            )}

            <textarea
              className="mt-32"
              style={{ minHeight: 260 }}
              value={draft}
              spellCheck={false}
              placeholder="在这里作答，尽量说清楚：为什么这么做、你负责哪一步、最后是什么结果。"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(draft);
              }}
            />
            <div className="fs-11 muted mt-8">⌘ / Ctrl + Enter 提交 · 支持语音（暂未开放）</div>

            {error && (
              <p className="small warn mt-8" role="alert">
                {error}
              </p>
            )}

            <div className="row wrap mt-24" style={{ gap: 10 }}>
              <button
                className="pill"
                type="button"
                disabled={state === "sending"}
                onClick={() => void submit("这题先跳过：我暂时答不上来。")}
              >
                跳过这题
              </button>
              <button
                className="pill solid"
                type="button"
                disabled={state === "sending" || !draft.trim()}
                onClick={() => void submit(draft)}
              >
                {state === "sending" ? "正在追问……" : "提交回答"}
              </button>
            </div>

            <div className="row wrap mt-48" style={{ gap: 6 }}>
              {targets.map((target, i) => (
                <span key={target.requirement_id} className={i < answered ? "tag" : "tag mute"}>
                  {i < answered ? "✓" : "·"} {target.question}
                </span>
              ))}
            </div>
          </>
        )}

        {session && session.status === "finished" && (
          <div className="panel mt-24">
            <div className="eyebrow">已结束 · {answered} / {total} 题</div>
            <p className="h3 mt-8">{session.finish_reason || "这场面试已经结束。"}</p>
            <p className="small mt-8">
              {error ? error : "复盘已生成，可以去看逐条判定。"}
            </p>
            <button className="pill solid mt-24" type="button" onClick={() => go("report")}>
              查看面试报告
            </button>
          </div>
        )}

        {state === "done" && !pendingTurn && error && (
          <p className="small warn mt-16" role="alert">
            {error}
          </p>
        )}
      </main>

      <Band
        step={3}
        total={4}
        label={`面试进行 · 已答 ${answered} 题 · 上限 ${total} 题`}
      />
    </div>
  );
}
