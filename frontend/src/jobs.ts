import type {
  ApiJob,
  JobCandidate,
  JobEmploymentType,
  JobMatch,
  RequirementScore,
} from "./api";
import type { Employment } from "./types";

export type Verify = "ok" | "pending" | "dead";

/** 页面用的岗位视图：只做展示映射，不再自带假数据。 */
export type JobView = {
  id: string;
  company: string;
  title: string;
  city: string;
  salary: string;
  employment: string;
  education: string;
  source: string;
  sourceUrl: string | null;
  verify: Verify;
  status: ApiJob["verification_status"];
  collected: string;
  requirements: string[];
  description: string;
  employmentType: JobEmploymentType | null;
};

export const EMPLOYMENT_OPTIONS: { label: Employment; value: JobEmploymentType }[] = [
  { label: "实习", value: "internship" },
  { label: "兼职", value: "part_time" },
  { label: "全职", value: "full_time" },
  { label: "合同", value: "contract" },
];

const EMPLOYMENT_LABEL: Record<JobEmploymentType, string> = {
  internship: "实习",
  part_time: "兼职",
  full_time: "全职",
  contract: "合同",
};

export function employmentLabelOf(type: JobEmploymentType | null): string {
  return type ? EMPLOYMENT_LABEL[type] : "未标注";
}

export function verifyOf(status: ApiJob["verification_status"]): Verify {
  if (status === "active") return "ok";
  if (status === "expired" || status === "source_unavailable") return "dead";
  return "pending";
}

function fmtMoney(value: number): string {
  if (value >= 1000) {
    const k = value / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return String(value);
}

export function salaryText(job: ApiJob): string {
  const { salary_min: min, salary_max: max, salary_period: period } = job;
  if (min == null && max == null) return "薪资面议";

  const unit = period === "day" ? " / 天" : period === "year" ? " / 年" : " / 月";
  if (min != null && max != null && min !== max) {
    return `${fmtMoney(min)}–${fmtMoney(max)}${unit}`;
  }
  const single = min ?? max ?? 0;
  return `${fmtMoney(single)}${unit}`;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "时间未知";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "时间未知";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

/** 岗位要求是一段文本：按换行/分号切成条目，一条一条对着看。 */
export function requirementLines(text: string): string[] {
  return text
    .split(/[\n；;]+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function toJobView(job: ApiJob): JobView {
  return {
    id: job.id,
    company: job.company,
    title: job.title,
    city: job.location?.trim() || "地点未标注",
    salary: salaryText(job),
    employment: employmentLabelOf(job.employment_type),
    // 后端岗位表没有学历字段，这里如实说「未标注」而不是编一个
    education: "未标注",
    source: job.source_name,
    sourceUrl: job.source_url,
    verify: verifyOf(job.verification_status),
    status: job.verification_status,
    collected: relativeTime(job.collected_at),
    requirements: requirementLines(job.requirements),
    description: job.description,
    employmentType: job.employment_type,
  };
}

/* ---------- 匹配结果 → 三列 ---------- */

export type MatchColumns = {
  met: string[];
  gap: string[];
  fail: string[];
  score: number;
  confidence: number;
  source: JobMatch["score_source"];
  mustCoverage: number;
};

/**
 * 三列全部来自后端：命中 / 缺证据 / 硬性不满足。
 * 分数是 0–1，展示时四舍五入到 0–100。
 */
export function matchColumns(match: JobMatch): MatchColumns {
  const fail = Array.from(new Set(match.must_gaps));
  const gap = match.gaps.filter((item) => !fail.includes(item));
  return {
    met: match.match_points,
    gap,
    fail,
    score: Math.round(match.score * 100),
    confidence: match.confidence,
    source: match.score_source,
    mustCoverage: match.must_coverage,
  };
}

export function requirementStatusLabel(status: RequirementScore["status"]): string {
  switch (status) {
    case "covered":
      return "满足";
    case "partial":
      return "部分满足";
    case "missing":
      return "没证据";
    default:
      return "无法判断";
  }
}

export function candidateScore(candidate: JobCandidate | null): number | null {
  return candidate ? Math.round(candidate.score * 100) : null;
}
