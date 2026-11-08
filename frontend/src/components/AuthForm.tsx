import { useState, type FormEvent } from "react";
import { ApiError, API_BASE, loginAccount, registerAccount } from "../api";
import { useProfile } from "../store";

type Props = {
  onNext: () => void;
  nextLabel?: string;
};

function explain(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "邮箱或密码不对，再试一次。";
    if (err.status === 409) return err.message;
    if (err.status === 422) return `填写不完整：${err.message}`;
    return err.message;
  }
  if (err instanceof TypeError) return `连不上后端（${API_BASE}）：确认服务已启动，再试一次。`;
  return err instanceof Error ? err.message : "网络异常，稍后再试。";
}

export default function AuthForm({ onNext, nextLabel = "去填档案 →" }: Props) {
  const { signIn } = useProfile();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; account: string; register: boolean } | null>(
    null
  );

  const passwordReady = password.length >= 8;
  const ready =
    !!email.trim() &&
    passwordReady &&
    (tab === "login" || !!name.trim()) &&
    !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;

    setBusy(true);
    setError(null);
    try {
      const session =
        tab === "register"
          ? await registerAccount({
              email: email.trim(),
              password,
              displayName: name.trim(),
            })
          : await loginAccount({ email: email.trim(), password });

      signIn(session);
      setDone({
        name: session.user.display_name,
        account: session.user.email,
        register: tab === "register",
      });
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="auth-done">
        <div className="eyebrow">已完成</div>
        <p className="h3 mt-8">
          {done.register ? "注册成功" : "登录成功"}，{done.name}
        </p>
        <p className="small mt-8">{done.account}</p>
        <p className="small mt-8">档案、画像和面试记录都挂在这个账户下。</p>
        <button className="pill solid mt-24" onClick={onNext} type="button">
          {nextLabel}
        </button>
      </div>
    );
  }

  return (
    <form className="auth" onSubmit={(e) => void submit(e)} noValidate>
      <div className="auth-tabs" role="tablist" aria-label="登录或注册">
        <button
          role="tab"
          aria-selected={tab === "login"}
          className={tab === "login" ? "on" : ""}
          onClick={() => {
            setTab("login");
            setError(null);
          }}
          type="button"
        >
          登录
        </button>
        <button
          role="tab"
          aria-selected={tab === "register"}
          className={tab === "register" ? "on" : ""}
          onClick={() => {
            setTab("register");
            setError(null);
          }}
          type="button"
        >
          注册
        </button>
      </div>

      <div className="auth-grid">
        {tab === "register" && (
          <label className="field">
            <span>昵称</span>
            <input
              value={name}
              autoComplete="nickname"
              placeholder="简历抬头会用它"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}

        <label className="field">
          <span>邮箱</span>
          <input
            value={email}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="field">
          <span>密码</span>
          <input
            value={password}
            type="password"
            autoComplete={tab === "register" ? "new-password" : "current-password"}
            placeholder="至少 8 位"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      </div>

      {password.length > 0 && !passwordReady && (
        <p className="small mt-8">密码至少 8 位。</p>
      )}

      {error && (
        <p className="small warn mt-8" role="alert">
          {error}
        </p>
      )}

      <button className="pill solid mt-24" type="submit" disabled={!ready}>
        {busy ? "正在连接后端……" : tab === "login" ? "登录" : "注册并进入"}
      </button>
    </form>
  );
}
