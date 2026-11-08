import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getToken,
  logoutAccount,
  readAccount,
  setToken,
  type AuthSession,
  type InterviewEvaluation,
} from "./api";
import { EMPTY_PROFILE, type InterviewResult, type Profile } from "./types";

const STORAGE_KEY = "jobhunter.state.v1";

export type SessionUser = { name: string; account?: string; id?: string };

type Persisted = {
  profile?: Partial<Profile>;
  interview?: InterviewResult | null;
  evaluation?: InterviewEvaluation | null;
  compare?: string[];
  user?: SessionUser | null;
  unlocked?: boolean;
  orderId?: string | null;
};

function load(): Persisted {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Persisted) : {};
  } catch {
    // 手动改坏或隐私模式禁用存储时，退回空档案
    return {};
  }
}

type Ctx = {
  profile: Profile;
  setProfile: (next: Profile) => void;
  patch: (partial: Partial<Profile>) => void;
  interview: InterviewResult | null;
  setInterview: (next: InterviewResult | null) => void;
  evaluation: InterviewEvaluation | null;
  setEvaluation: (next: InterviewEvaluation | null) => void;
  compare: string[];
  toggleCompare: (id: string) => void;
  user: SessionUser | null;
  setUser: (next: SessionUser | null) => void;
  signIn: (session: AuthSession) => void;
  signOut: () => void;
  unlocked: boolean;
  setUnlocked: (next: boolean) => void;
  orderId: string | null;
  setOrderId: (next: string | null) => void;
};

const ProfileContext = createContext<Ctx | null>(null);

/**
 * 退出 / 换账户时把「后端句柄 + 从简历里抽出来的东西」全部清掉。
 * 留着下一个登录的人看到上一份简历的摘要，是比少一次上传更糟的事。
 */
function clearedProfile(prev: Profile): Profile {
  return {
    ...prev,
    backendUserId: undefined,
    backendProfileId: undefined,
    resume: null,
    resumeId: null,
    summary: undefined,
    skills: [],
    experiences: [],
    evidence: [],
    extraction: undefined,
    recommendedRoles: [],
    missingInformation: [],
    draftResumeId: undefined,
    draftVersion: undefined,
    answers: {},
  };
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [restored] = useState<Persisted>(load);
  const [profile, setProfile] = useState<Profile>(() => ({
    ...EMPTY_PROFILE,
    ...restored.profile,
    target: { ...EMPTY_PROFILE.target, ...restored.profile?.target },
  }));
  const [interview, setInterview] = useState<InterviewResult | null>(restored.interview ?? null);
  const [evaluation, setEvaluation] = useState<InterviewEvaluation | null>(
    restored.evaluation ?? null
  );
  const [compare, setCompare] = useState<string[]>(restored.compare ?? []);
  const [user, setUser] = useState<SessionUser | null>(restored.user ?? null);
  const [unlocked, setUnlocked] = useState<boolean>(restored.unlocked ?? false);
  const [orderId, setOrderId] = useState<string | null>(restored.orderId ?? null);

  // 任何一个状态变化都写回 localStorage，刷新页面不丢
  useEffect(() => {
    try {
      const data: Persisted = {
        profile,
        interview,
        evaluation,
        compare,
        user,
        unlocked,
        orderId,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // 配额满 / 隐私模式：忽略，不影响当前会话
    }
  }, [profile, interview, evaluation, compare, user, unlocked, orderId]);

  // 有令牌就向后端确认一次：被吊销 / 过期的令牌不该继续显示成已登录
  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    readAccount()
      .then((account) => {
        if (cancelled) return;
        setUser((prev) => ({
          name: account.display_name,
          account: account.email,
          id: account.id,
        }));
        setProfile((prev) =>
          prev.backendUserId === account.id ? prev : { ...prev, backendUserId: account.id }
        );
      })
      .catch(() => {
        if (cancelled) return;
        setToken(null);
        setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      profile,
      setProfile,
      patch: (partial) => setProfile((prev) => ({ ...prev, ...partial })),
      interview,
      setInterview,
      evaluation,
      setEvaluation,
      compare,
      toggleCompare: (id) =>
        setCompare((prev) =>
          prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 4 ? prev : [...prev, id]
        ),
      user,
      setUser,
      signIn: (session) => {
        setToken(session.access_token);
        const account: SessionUser = {
          name: session.user.display_name,
          account: session.user.email,
          id: session.user.id,
        };
        const sameAccount = user?.id === account.id;
        setUser(account);
        // 换了账户：上一个账户的画像 / 简历 / 草稿 / 购买状态全部作废，不能串用
        setProfile((prev) => {
          if (prev.backendUserId === account.id) return { ...prev, backendUserId: account.id };
          return { ...clearedProfile(prev), backendUserId: account.id };
        });
        if (!sameAccount) {
          setUnlocked(false);
          setOrderId(null);
          setInterview(null);
          setEvaluation(null);
        }
      },
      signOut: () => {
        void logoutAccount();
        setToken(null);
        setUser(null);
        setUnlocked(false);
        setOrderId(null);
        setInterview(null);
        setEvaluation(null);
        setProfile(clearedProfile);
      },
      unlocked,
      setUnlocked,
      orderId,
      setOrderId,
    }),
    [profile, interview, evaluation, compare, user, unlocked, orderId]
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): Ctx {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used inside <ProfileProvider>");
  return ctx;
}
