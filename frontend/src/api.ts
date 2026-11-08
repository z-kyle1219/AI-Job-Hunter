import type { Profile } from "./types";

const configured = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

/** 后端地址：本地默认 8000，部署时用 VITE_API_BASE 覆盖。 */
export const API_BASE = configured.replace(/\/+$/, "");

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const TOKEN_KEY = "jobhunter.token.v1";

/** 令牌只在浏览器里存一份；后端把令牌当不透明字符串，前端也不去解析它。 */
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 隐私模式禁用存储：本次会话仍然可用，只是刷新后要重新登录
  }
}

function describe(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) =>
        item && typeof item === "object" && "msg" in item
          ? String((item as { msg: unknown }).msg)
          : JSON.stringify(item)
      )
      .join("；");
  }
  if (detail && typeof detail === "object") {
    // 岗位匹配的 422 长这样：{ message, rejections, unknowns }，逐条读出来比丢一整坨 JSON 有用
    const body = detail as { message?: unknown; rejections?: unknown; unknowns?: unknown };
    const parts: string[] = [];
    if (typeof body.message === "string") parts.push(body.message);
    if (Array.isArray(body.rejections) && body.rejections.length) {
      parts.push(`不满足：${body.rejections.join("；")}`);
    }
    if (Array.isArray(body.unknowns) && body.unknowns.length) {
      parts.push(`无法判断：${body.unknowns.join("；")}`);
    }
    if (parts.length) return parts.join(" · ");
  }
  return JSON.stringify(detail);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const data: unknown = await res.json();
      if (data && typeof data === "object" && "detail" in data) {
        detail = describe((data as { detail: unknown }).detail);
      }
    } catch {
      // 非 JSON 错误体：保留状态码和状态文本
    }
    // 令牌过期或被吊销：清掉本地那份，页面下一轮会显示成未登录
    if (res.status === 401 && !path.startsWith("/api/v1/auth/")) setToken(null);
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function jsonBody(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/* ---------- 账户 ---------- */

export type Account = {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
  updated_at: string;
};

export type AuthSession = {
  access_token: string;
  token_type: "bearer";
  expires_at: string;
  user: Account;
};

export async function registerAccount(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<AuthSession> {
  const data = await request<AuthSession>(
    "/api/v1/auth/register",
    jsonBody({ email: input.email, password: input.password, display_name: input.displayName })
  );
  setToken(data.access_token);
  return data;
}

export async function loginAccount(input: {
  email: string;
  password: string;
}): Promise<AuthSession> {
  const data = await request<AuthSession>("/api/v1/auth/login", jsonBody(input));
  setToken(data.access_token);
  return data;
}

export async function logoutAccount(): Promise<void> {
  try {
    await request<void>("/api/v1/auth/logout", { method: "POST" });
  } finally {
    // 服务端吊销失败也把本地令牌清掉：留着它只会换来源源不断的 401
    setToken(null);
  }
}

export function readAccount(): Promise<Account> {
  return request<Account>("/api/v1/auth/me");
}

/* ---------- 简历抽取 ---------- */

export type ExtractedProfile = {
  summary: string;
  skills: string[];
  experiences: string[];
};

export type ExtractionResult = {
  profile: ExtractedProfile | null;
  recommended_roles: string[];
  missing_information: string[];
  evidence: string[];
  unresolved_evidence: string[];
  chunk_ids: string[];
  degraded: boolean;
  resume_id: string | null;
  notes: string[];
};

export function extractResume(file: File, userId?: string): Promise<ExtractionResult> {
  const params = new URLSearchParams({ filename: file.name });
  if (userId) params.set("user_id", userId);
  return request<ExtractionResult>(`/api/v1/profiles/extract/file?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
}

/* ---------- 用户 / 画像确认 / 简历草稿 ---------- */

export type User = { id: string; email: string; display_name: string };

function randomSuffix() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * 未登录时的临时账户：不写密码，只用来挂简历记录。
 * 登录后一律用真实账户 id，不再创建这种账户。
 */
export async function createUser(displayName: string): Promise<User> {
  return request<User>(
    "/api/v1/users",
    jsonBody({
      email: `demo-${randomSuffix()}@example.com`,
      display_name: displayName.trim() || "求职者",
    })
  );
}

export type EmploymentType = "internship" | "part_time" | "full_time" | "contract";

const EMPLOYMENT: Record<string, EmploymentType> = {
  实习: "internship",
  兼职: "part_time",
  全职: "full_time",
  合同: "contract",
  校招: "full_time",
  社招: "full_time",
};

export function employmentTypeOf(label?: string): EmploymentType | null {
  if (!label) return null;
  return EMPLOYMENT[label] ?? null;
}

function toProfileInput(profile: Profile) {
  const skills = profile.skills?.length
    ? profile.skills
    : profile.projects.map((project) => project.name);
  const experiences = [
    ...(profile.experiences ?? []),
    ...(profile.stories.trim() ? [profile.stories.trim()] : []),
    ...profile.projects.map((project) => `项目：${project.name}`),
  ];
  const summary =
    [
      profile.summary,
      profile.target.role,
      profile.target.city,
      profile.target.employment ? `求职类型 ${profile.target.employment}` : "",
    ]
      .filter((value): value is string => !!value && value.trim().length > 0)
      .join("；") || "求职者档案";

  return { summary, skills, experiences };
}

export type ApiRequirements = {
  desired_role: string;
  locations: string[];
  employment_type: EmploymentType;
  employment_type_source: "default" | "confirmed";
  salary_min: number | null;
  salary_max: number | null;
  salary_period: "day" | "month" | "year";
  skill_level: string | null;
};

export type ApiProfile = {
  id: string;
  user_id: string;
  requirements: ApiRequirements;
  capabilities: {
    summary: string;
    skills: string[];
    experiences: string[];
    target_roles: string[];
    suggested_roles: string[];
    target_roles_source: "suggested" | "confirmed";
  };
  personal_info: PersonalInfo;
  missing_information: string[];
  evidence: string[];
  source_resume_id: string | null;
  created_at: string;
  updated_at: string;
};

/** 人工确认节点：把前端档案映射成后端画像并落库，返回完整画像。 */
export async function confirmProfile(profile: Profile): Promise<ApiProfile> {
  if (!profile.backendUserId) throw new Error("还没有建立后端用户，请先上传简历。");

  const employmentType = employmentTypeOf(profile.target.employment) ?? "internship";
  const body = {
    user_id: profile.backendUserId,
    requirements: {
      desired_role:
        profile.target.role?.trim() || profile.recommendedRoles?.[0] || "求职方向待确认",
      locations: profile.target.city ? [profile.target.city] : [],
      employment_type: employmentType,
      employment_type_source: profile.target.employment ? "confirmed" : "default",
    },
    profile: toProfileInput(profile),
    // 上一次补全过的电话 / 城市不能因为重新确认而被清空，这里不重复提交
    recommended_roles: profile.recommendedRoles ?? [],
    target_roles: profile.target.role ? [profile.target.role] : null,
    missing_information: profile.missingInformation ?? [],
    resume_id: profile.resumeId ?? null,
    evidence: profile.evidence ?? [],
  };

  return request<ApiProfile>("/api/v1/profiles/extract/confirm", jsonBody(body));
}

export function getProfile(profileId: string): Promise<ApiProfile> {
  return request<ApiProfile>(`/api/v1/profiles/${profileId}`);
}

export type PendingField = {
  field: string;
  label: string;
  ask: string;
  why: string;
  blocking: boolean;
};

/** 后端按规则算出来的「还缺什么」，不是模型编的。 */
export function getPendingFields(profileId: string): Promise<PendingField[]> {
  return request<PendingField[]>(`/api/v1/profiles/${profileId}/pending`);
}

export type PersonalInfo = {
  full_name: string;
  phone: string;
  email: string;
  city: string;
  links: string[];
};

/** 空值表示「还没答」，后端只合并、不覆盖。 */
export async function savePersonalInfo(
  profileId: string,
  info: Partial<PersonalInfo>
): Promise<ApiProfile> {
  return request<ApiProfile>(`/api/v1/profiles/${profileId}/personal-info`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      full_name: info.full_name ?? "",
      phone: info.phone ?? "",
      email: info.email ?? "",
      city: info.city ?? "",
      links: info.links ?? [],
    }),
  });
}

export type ResumeDraftBullet = { text: string; sources: string[] };
export type ResumeDraftExperience = { heading: string; bullets: ResumeDraftBullet[] };
export type CitedChunk = { id: string; source: string; section: string; text: string };

export type ResumeDraft = {
  profileId: string;
  resumeId: string | null;
  version: number;
  headline: string;
  summary: string;
  experiences: ResumeDraftExperience[];
  skills: string[];
  education: string[];
  suggestions: string[];
  citedChunks: CitedChunk[];
  unresolvedEvidence: string[];
  unverifiedBullets: number;
  unverifiedFields: number;
  degraded: boolean;
  notes: string[];
};

type RawDraft = {
  profile_id: string;
  resume_id: string | null;
  version: number;
  headline: string;
  summary: string;
  experiences: { heading: string; bullets: { text: string; sources: string[] }[] }[];
  skills: string[];
  education: string[];
  suggestions: string[];
  cited_chunks: CitedChunk[];
  unresolved_evidence: string[];
  unverified_bullets: number;
  unverified_fields: number;
  degraded: boolean;
  notes: string[];
};

export async function draftResume(profileId: string): Promise<ResumeDraft> {
  const data = await request<RawDraft>("/api/v1/resumes/draft", jsonBody({ profile_id: profileId }));

  return {
    profileId: data.profile_id,
    resumeId: data.resume_id,
    version: data.version,
    headline: data.headline,
    summary: data.summary,
    experiences: data.experiences,
    skills: data.skills,
    education: data.education,
    suggestions: data.suggestions,
    citedChunks: data.cited_chunks,
    unresolvedEvidence: data.unresolved_evidence,
    unverifiedBullets: data.unverified_bullets,
    unverifiedFields: data.unverified_fields,
    degraded: data.degraded,
    notes: data.notes,
  };
}

/* ---------- 岗位库 ---------- */

export type JobEmploymentType = EmploymentType;
export type JobSalaryPeriod = "day" | "month" | "year";
export type JobVerificationStatus =
  | "active"
  | "expired"
  | "pending_verification"
  | "source_unavailable"
  | "unknown";

/** `GET /jobs` 返回的原始岗位，字段和后端 JobRead 一一对应。 */
export type ApiJob = {
  id: string;
  title: string;
  company: string;
  description: string;
  requirements: string;
  employment_type: JobEmploymentType | null;
  source_name: string;
  source_url: string | null;
  location: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_period: JobSalaryPeriod | null;
  verification_status: JobVerificationStatus;
  collected_at: string;
  last_seen_at: string | null;
  last_verified_at: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
};

export function listJobs(params?: {
  employmentType?: JobEmploymentType | null;
  status?: JobVerificationStatus | null;
}): Promise<ApiJob[]> {
  const search = new URLSearchParams();
  if (params?.employmentType) search.set("employment_type", params.employmentType);
  if (params?.status) search.set("verification_status", params.status);
  const query = search.toString();
  return request<ApiJob[]>(`/api/v1/jobs${query ? `?${query}` : ""}`);
}

export function getJob(jobId: string): Promise<ApiJob> {
  return request<ApiJob>(`/api/v1/jobs/${jobId}`);
}

export type JobCollectResult = {
  source: string;
  fetched: number;
  created: string[];
  updated: string[];
  total: number;
  warnings: string[];
};

/** 用户触发的采集：把来源今天的岗位并入库，失败会自己说清原因。 */
export function collectJobs(limit = 20): Promise<JobCollectResult> {
  return request<JobCollectResult>("/api/v1/jobs/collect", jsonBody({ limit }));
}

/* ---------- 岗位检索（带排除理由） ---------- */

export type JobQuery = {
  role: string;
  keywords: string[];
  locations: string[];
  employment_type: JobEmploymentType | null;
  salary_min: number | null;
  salary_period: JobSalaryPeriod;
  expand: boolean;
  aliases: string[];
  verified_only: boolean;
  limit: number;
};

export type JobCandidate = {
  job_id: string;
  title: string;
  company: string;
  location: string | null;
  employment_type: JobEmploymentType | null;
  source_name: string;
  source_url: string | null;
  score: number;
  matched: string[];
  aliases_matched: string[];
  missing: string[];
  reason: string;
  warnings: string[];
  verification_status: JobVerificationStatus | null;
  last_verified_at: string | null;
  collected_at: string | null;
};

export type JobExclusion = {
  job_id: string;
  title: string;
  company: string;
  reasons: string[];
};

export type JobSearchResult = {
  query: JobQuery;
  candidates: JobCandidate[];
  excluded: JobExclusion[];
  total_scanned: number;
  prefiltered_out: number;
  notes: string[];
  applied_profile_id: string | null;
};

export function searchJobs(body: {
  query?: Partial<JobQuery>;
  profile_id?: string | null;
}): Promise<JobSearchResult> {
  return request<JobSearchResult>("/api/v1/job-search", jsonBody(body));
}

/* ---------- 岗位匹配（逐条，带要求级拆解） ---------- */

export type RequirementScore = {
  requirement_id: string;
  text: string;
  kind: "must" | "should" | "nice";
  dimension: "skill" | "experience" | "domain" | "education" | "language" | "other";
  weight: number;
  coverage: number;
  status: "covered" | "partial" | "missing" | "unknown";
  matched_terms: string[];
  missing_terms: string[];
  evidence: string[];
};

export type JobMatch = {
  id: string;
  user_profile_id: string;
  job_id: string;
  /** 0–1，展示时再乘 100 */
  score: number;
  match_points: string[];
  gaps: string[];
  recommendation: string;
  confidence: number;
  unknowns: string[];
  breakdown: RequirementScore[];
  must_gaps: string[];
  must_coverage: number;
  score_source: "extracted" | "heuristic";
  created_at: string;
};

export function matchJob(profileId: string, jobId: string): Promise<JobMatch> {
  return request<JobMatch>(
    "/api/v1/job-matches",
    jsonBody({ user_profile_id: profileId, job_id: jobId })
  );
}

/* ---------- 模拟面试 ---------- */

export type InterviewTurn = {
  index: number;
  kind: "ask" | "probe";
  requirement_id: string;
  requirement_text: string;
  question: string;
  why: string;
  answer: string | null;
};

export type InterviewTarget = {
  requirement_id: string;
  question: string;
  why: string;
};

export type InterviewSession = {
  id: string;
  profile_id: string;
  job_id: string;
  status: "in_progress" | "finished";
  max_turns: number;
  plan: { opening: string; targets: InterviewTarget[] };
  turns: InterviewTurn[];
  remaining: string[];
  finish_reason: string;
  notes: string[];
  created_at: string;
  updated_at: string;
};

export type RequirementVerdict = {
  requirement_id: string;
  requirement_text: string;
  verdict: "answered" | "surface" | "unanswered";
  evidence: string;
  gap: string;
  suggestion: string;
};

export type InterviewEvaluation = {
  verdicts: RequirementVerdict[];
  strengths: string[];
  suggestions: string[];
  overall: string;
  /** answered / requirements，是计数，不是质量分 */
  coverage: number;
  notes: string[];
  evaluator_version: string;
};

export function startInterview(
  profileId: string,
  jobId: string,
  maxTurns = 8
): Promise<InterviewSession> {
  return request<InterviewSession>(
    "/api/v1/interviews",
    jsonBody({ profile_id: profileId, job_id: jobId, max_turns: maxTurns })
  );
}

export function answerInterview(interviewId: string, answer: string): Promise<InterviewSession> {
  return request<InterviewSession>(
    `/api/v1/interviews/${interviewId}/answers`,
    jsonBody({ answer })
  );
}

export function getInterviewSession(interviewId: string): Promise<InterviewSession> {
  return request<InterviewSession>(`/api/v1/interviews/${interviewId}`);
}

export function evaluateInterviewSession(
  interviewId: string,
  refresh = false
): Promise<InterviewEvaluation> {
  return request<InterviewEvaluation>(
    `/api/v1/interviews/${interviewId}/evaluation?refresh=${refresh ? "true" : "false"}`,
    { method: "POST" }
  );
}

/* ---------- 计费 ---------- */

export type Product = {
  code: string;
  name: string;
  description: string;
  price_cents: number;
  currency: string;
  unit: string;
  grants: string;
  features: string[];
};

export type Order = {
  id: string;
  user_id: string;
  product_code: string;
  quantity: number;
  amount_cents: number;
  currency: string;
  status: "created" | "paid" | "cancelled" | "refunded";
  provider: string | null;
  provider_ref: string | null;
  created_at: string;
  paid_at: string | null;
};

export type QuotaLine = { granted: number; used: number; remaining: number };

export type OrderHistory = {
  user_id: string;
  orders: Order[];
  resume: QuotaLine;
  interview: QuotaLine;
};

export function listProducts(): Promise<Product[]> {
  return request<Product[]>("/api/v1/products");
}

/** 金额由后端按价目表算，请求里不带价格。 */
export function createOrder(input: {
  userId: string;
  productCode: string;
  quantity?: number;
  idempotencyKey?: string;
}): Promise<Order> {
  return request<Order>(
    "/api/v1/orders",
    jsonBody({
      user_id: input.userId,
      product_code: input.productCode,
      quantity: input.quantity ?? 1,
      idempotency_key: input.idempotencyKey ?? null,
    })
  );
}

export function getOrder(orderId: string): Promise<Order> {
  return request<Order>(`/api/v1/orders/${orderId}`);
}

/** 演示支付：只能声明 simulated，后端会把这笔订单标成模拟支付。 */
export function payOrder(orderId: string): Promise<Order> {
  return request<Order>(`/api/v1/orders/${orderId}/payment`, jsonBody({ provider: "simulated" }));
}

export type Delivery = {
  id: string;
  order_id: string;
  kind: string;
  ref_id: string;
  created_at: string;
};

/** 把交付物（面试会话 / 简历）挂到已支付订单上，形成「买了什么」的记录。 */
export function deliverOrder(orderId: string, refId: string): Promise<Delivery> {
  return request<Delivery>(`/api/v1/orders/${orderId}/deliveries`, jsonBody({ ref_id: refId }));
}

export function getOrderHistory(userId: string): Promise<OrderHistory> {
  return request<OrderHistory>(`/api/v1/users/${userId}/orders`);
}
