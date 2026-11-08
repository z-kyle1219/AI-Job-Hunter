import { useState } from "react";
import Top from "../components/Top";
import Band from "../components/Band";
import { useProfile } from "../store";
import { ApiError, evaluateInterviewSession } from "../api";
import type { Route } from "../App";

type Props = {
  go: (r: Route) => void;
};

const VERDICT_LABEL: Record<string, string> = {
  answered: "答到了",
  surface: "只到表面",
  unanswered: "没答到",
};

const VERDICT_CLASS: Record<string, string> = {
  answered: "tag",
  surface: "tag dash",
  unanswered: "tag red",
};

export default function Report({ go }: Props) {
  const { interview, evaluation, unlocked, setEvaluation, setInterview } = useProfile();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const answers = interview?.answers ?? [];
  const seconds = interview?.seconds ?? 0;
  const coverage = evaluation ? Math.round(evaluation.coverage * 100) : null;

  async function retryReview() {
    if (!interview?.sessionId || retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const review = await evaluateInterviewSession(interview.sessionId, true);
      setEvaluation(review);
      setInterview({ ...interview, coverage: review.coverage, overall: review.overall });
    } catch (err) {
      setRetryError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="shell" id="main">
      <Top onHome={() => go("home")} back={{ label: "返回主页", onClick: () => go("home") }} />

      <main className="page">
        <div className="eyebrow">
          {interview?.company || interview?.jobTitle
            ? `${interview?.company ?? ""}${interview?.company && interview?.jobTitle ? " · " : ""}${
                interview?.jobTitle ?? ""
              }`
            : "模拟面试"}
        </div>
        <h1 className="h1 mt-16">面试报告</h1>
        <p className="lead">
          {evaluation
            ? `${answers.length} 题 · ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒 · 需求覆盖 ${coverage}%`
            : interview
              ? `${answers.length} 题 · ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒 · 复盘未生成`
              : "还没有面试记录"}
        </p>

        {!evaluation ? (
          <div className="panel mt-32">
            <div className="eyebrow">复盘 · 0 条</div>
            <p className="h3 mt-8">
              {interview ? "这场面试的复盘没有生成" : "先做一场模拟面试，才有可复盘的内容"}
            </p>
            <p className="small mt-8">
              {interview
                ? "复盘由模型逐条判定，失败通常是模型 Key 缺失或调用超时。可以再面一场，或稍后重试。"
                : "报告里的每一条判定都引用你自己的原话，不会给一个无法复核的总分。"}
            </p>
            <div className="row wrap mt-24" style={{ gap: 10 }}>
              {interview?.sessionId && (
                <button
                  className="pill solid"
                  type="button"
                  disabled={retrying}
                  onClick={() => void retryReview()}
                >
                  {retrying ? "正在重新复盘……" : "重新生成复盘"}
                </button>
              )}
              <button className="pill solid" type="button" onClick={() => go("interview")}>
                去面试
              </button>
              <button className="pill" type="button" onClick={() => go("jobs")}>
                先挑个岗位
              </button>
            </div>
            {retryError && (
              <p className="small warn mt-8" role="alert">
                {retryError}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="verdict mt-32">
              <div className="v-num num">
                {coverage === null ? "—" : coverage}
                <span className="muted" style={{ fontSize: "0.3em", letterSpacing: 0 }}>
                  {" "}
                  %
                </span>
              </div>
              <div className="v-txt">
                <div className="eyebrow">需求覆盖率 / 不是质量分</div>
                <p className="mt-8">{evaluation.overall || "复盘没有给出总评。"}</p>
              </div>
            </div>

            <div className="mt-32" style={{ borderTop: "1.5px solid var(--ink)" }}>
              {evaluation.verdicts.map((verdict) => (
                <div
                  key={verdict.requirement_id}
                  style={{ padding: "16px 0", borderBottom: "1px solid var(--line)" }}
                >
                  <div className="row between wrap" style={{ gap: 12, alignItems: "baseline" }}>
                    <span className="h3" style={{ fontSize: 15 }}>
                      {verdict.requirement_text || verdict.requirement_id}
                    </span>
                    <span className={VERDICT_CLASS[verdict.verdict] ?? "tag"}>
                      {VERDICT_LABEL[verdict.verdict] ?? verdict.verdict}
                    </span>
                  </div>

                  {unlocked && verdict.evidence && (
                    <p className="small mt-8" style={{ borderLeft: "3px solid var(--line)", paddingLeft: 10 }}>
                      你的原话：{verdict.evidence}
                    </p>
                  )}
                  {unlocked && verdict.gap && <p className="small mt-8">缺口：{verdict.gap}</p>}
                  {unlocked && verdict.suggestion && (
                    <p className="small mt-8">怎么改：{verdict.suggestion}</p>
                  )}
                </div>
              ))}
              {evaluation.verdicts.length === 0 && (
                <div style={{ padding: "16px 0", borderBottom: "1px solid var(--line)" }}>
                  <span className="small">这场没有可比对的需求。</span>
                </div>
              )}
            </div>

            {unlocked ? (
              <>
                {evaluation.strengths.length > 0 && (
                  <div className="mt-48">
                    <div className="row between wrap" style={{ gap: 12 }}>
                      <h2 className="h2">答得住的</h2>
                      <span className="eyebrow">{evaluation.strengths.length} 项</span>
                    </div>
                    <div className="col-list mt-16">
                      <ul>
                        {evaluation.strengths.map((item, i) => (
                          <li key={i}>
                            <em>✓</em>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                <div className="mt-48">
                  <div className="row between wrap" style={{ gap: 12 }}>
                    <h2 className="h2">下一步怎么改</h2>
                    <span className="eyebrow">{evaluation.suggestions.length} 项</span>
                  </div>
                  {evaluation.suggestions.length ? (
                    <div className="mt-16" style={{ borderTop: "1.5px solid var(--ink)" }}>
                      {evaluation.suggestions.map((item, i) => (
                        <div
                          key={i}
                          className="row between wrap"
                          style={{
                            gap: 20,
                            padding: "18px 0",
                            borderBottom: "1px solid var(--line)",
                          }}
                        >
                          <div>
                            <div className="h3">{item}</div>
                          </div>
                          <button
                            className="pill sm"
                            type="button"
                            onClick={() => go("interview")}
                          >
                            重练
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="small mt-8">这场没有被指出的短板，可以换个岗位再来一场。</p>
                  )}
                </div>

                {evaluation.notes.length > 0 && (
                  <p className="small mt-24">复盘备注：{evaluation.notes.join("；")}</p>
                )}

                <div className="row wrap mt-32" style={{ gap: 10 }}>
                  <button className="pill solid" type="button" onClick={() => go("interview")}>
                    再练一次
                  </button>
                  <button className="pill" type="button" onClick={() => go("jobs")}>
                    换个岗位
                  </button>
                  <button className="pill" type="button" onClick={() => go("archive")}>
                    回到档案
                  </button>
                </div>
              </>
            ) : (
              <div className="panel y mt-32">
                <div className="eyebrow">完整报告 · 未解锁</div>
                <p className="h2 mt-8">逐条判定已经给出，证据和改法还在后面。</p>
                <p className="small mt-8">
                  完整报告包含：每条要求引用的原话、缺口说明、逐项改法，以及下一步练习清单。
                </p>
                <button
                  className="pill solid mt-24"
                  onClick={() => go("purchase")}
                  type="button"
                >
                  购买服务解锁全部 →
                </button>
              </div>
            )}
          </>
        )}
      </main>

      <Band
        step={4}
        total={4}
        label={
          coverage === null ? "面试报告 · 暂无复盘" : `面试报告 · 需求覆盖 ${coverage}%`
        }
        action={
          evaluation
            ? unlocked
              ? { label: "回到档案", onClick: () => go("archive") }
              : { label: "解锁完整报告", onClick: () => go("purchase") }
            : { label: "去面试", onClick: () => go("interview") }
        }
      />
    </div>
  );
}
