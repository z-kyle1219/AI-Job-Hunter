import { useEffect, useState } from "react";
import Top from "../components/Top";
import Band from "../components/Band";
import { useProfile } from "../store";
import {
  ApiError,
  getPendingFields,
  getProfile,
  savePersonalInfo,
  type PendingField,
} from "../api";
import { emailLooksValid } from "../email";
import { ensureBackendProfile } from "../profileSync";
import type { Route } from "../App";

type Props = {
  go: (r: Route) => void;
};

type Form = {
  full_name: string;
  phone: string;
  email: string;
  city: string;
  links: string;
};

type State = "nologin" | "loading" | "ready" | "error";

const EMPTY_FORM: Form = { full_name: "", phone: "", email: "", city: "", links: "" };

/** 后端 personal-info 接口能接住的字段；其余缺口要回去改经历本身。 */
const EDITABLE = new Set(["full_name", "phone", "email", "city", "links"]);

function splitLinks(value: string): string[] {
  return value
    .split(/[\n,，;；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function PersonalInfo({ go }: Props) {
  const { profile, patch, user } = useProfile();
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [pending, setPending] = useState<PendingField[]>([]);
  const [state, setState] = useState<State>(profile.backendUserId ? "loading" : "nologin");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile.backendUserId) {
      setState("nologin");
      return;
    }
    let cancelled = false;
    setState("loading");

    void (async () => {
      try {
        const profileId = await ensureBackendProfile(profile, patch);
        const [apiProfile, fields] = await Promise.all([
          getProfile(profileId),
          getPendingFields(profileId),
        ]);
        if (cancelled) return;
        setForm({
          full_name: apiProfile.personal_info.full_name ?? "",
          phone: apiProfile.personal_info.phone ?? "",
          email: apiProfile.personal_info.email ?? "",
          city: apiProfile.personal_info.city ?? "",
          links: (apiProfile.personal_info.links ?? []).join("\n"),
        });
        setPending(fields);
        setState("ready");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : (err as Error).message);
        setState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.backendUserId]);

  async function save() {
    const profileId = profile.backendProfileId;
    if (!profileId || saving) return;
    if (form.email.trim() && !emailLooksValid(form.email)) {
      setNotice(null);
      setError("邮箱格式不正确，需要像 you@example.com 这样的地址。");
      return;
    }

    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const updated = await savePersonalInfo(profileId, {
        full_name: form.full_name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        city: form.city.trim(),
        links: splitLinks(form.links),
      });
      const fields = await getPendingFields(profileId);
      setPending(fields);
      setForm({
        full_name: updated.personal_info.full_name ?? "",
        phone: updated.personal_info.phone ?? "",
        email: updated.personal_info.email ?? "",
        city: updated.personal_info.city ?? "",
        links: (updated.personal_info.links ?? []).join("\n"),
      });
      setNotice(
        fields.length
          ? `已保存，后端还剩 ${fields.length} 项没补齐。`
          : "已保存，后端已经没有未填项。"
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const editable = pending.filter((item) => EDITABLE.has(item.field));
  const rest = pending.filter((item) => !EDITABLE.has(item.field));
  const blocking = pending.filter((item) => item.blocking).length;

  return (
    <div className="shell" id="main">
      <Top onHome={() => go("home")} back={{ label: "返回主页", onClick: () => go("home") }} />

      <main className="page">
        <div className="eyebrow">A 区 · 个人信息</div>
        <h1 className="h1 mt-16">补全清单</h1>
        <p className="lead">
          下面这些问题由后端按规则算出来：字段为空、经历没有时间、经历没有数字。不是模型猜的「你还缺什么」。
        </p>

        {state === "nologin" && (
          <div className="panel mt-32">
            <div className="eyebrow">还没有账户</div>
            <p className="h3 mt-8">补全清单挂在画像上</p>
            <p className="small mt-8">
              先登录、上传一份简历，后端才会有 profile_id，也才会算出这份清单。
            </p>
            <div className="row wrap mt-24" style={{ gap: 10 }}>
              <button className="pill solid" type="button" onClick={() => go("upload")}>
                去上传简历
              </button>
              <button className="pill" type="button" onClick={() => go("home")}>
                回主页登录
              </button>
            </div>
          </div>
        )}

        {state === "error" && (
          <div className="panel mt-32">
            <div className="eyebrow">读取失败</div>
            <p className="h3 mt-8">{error}</p>
            <button className="pill solid mt-24" type="button" onClick={() => go("upload")}>
              重新上传简历
            </button>
          </div>
        )}

        {state === "ready" && (
          <>
            <div className="row between wrap mt-24" style={{ gap: 12 }}>
              <span className="fs-13 muted">
                待补 <b className="mono" style={{ fontSize: 18, color: "var(--ink)" }}>{pending.length}</b> 项
                {blocking > 0 ? ` · 其中 ${blocking} 项阻塞投递` : ""}
              </span>
              {user?.account && <span className="small">账号邮箱 · {user.account}</span>}
            </div>

            <div className="panel mt-16">
              <div className="eyebrow">可以直接在这里填</div>
              <div className="row wrap mt-16" style={{ gap: 16 }}>
                <label className="field" style={{ flex: "1 1 200px", marginTop: 0 }}>
                  <span>姓名</span>
                  <input
                    value={form.full_name}
                    placeholder="简历抬头上的名字"
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  />
                </label>
                <label className="field" style={{ flex: "1 1 200px", marginTop: 0 }}>
                  <span>手机号</span>
                  <input
                    value={form.phone}
                    inputMode="tel"
                    placeholder="能打通的手机号"
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </label>
                <label className="field" style={{ flex: "1 1 220px", marginTop: 0 }}>
                  <span>邮箱</span>
                  <input
                    value={form.email}
                    type="email"
                    autoComplete="email"
                    placeholder={user?.account ?? "you@example.com"}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </label>
                <label className="field" style={{ flex: "1 1 160px", marginTop: 0 }}>
                  <span>所在城市</span>
                  <input
                    value={form.city}
                    placeholder="上海"
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                  />
                </label>
              </div>

              <label className="field">
                <span>作品 / 主页链接（一行一个）</span>
                <textarea
                  value={form.links}
                  spellCheck={false}
                  style={{ minHeight: 88 }}
                  placeholder={"https://github.com/you\nhttps://your.blog"}
                  onChange={(e) => setForm({ ...form, links: e.target.value })}
                />
              </label>

              <div className="row between wrap mt-16" style={{ gap: 12 }}>
                <span className="small">
                  只提交填了的项：留空表示「还没答」，不会把已填的清掉。
                </span>
                <button
                  className="pill solid"
                  type="button"
                  disabled={saving}
                  onClick={() => void save()}
                >
                  {saving ? "保存中……" : "保存并重新计算"}
                </button>
              </div>

              {notice && <p className="small mt-8">{notice}</p>}
              {error && (
                <p className="small warn mt-8" role="alert">
                  {error}
                </p>
              )}
            </div>

            <div className="eyebrow mt-32">清单 · {pending.length}</div>
            <div className="mt-8" style={{ borderTop: "1.5px solid var(--ink)" }}>
              {pending.length === 0 ? (
                <div style={{ padding: "16px 0", borderBottom: "1px solid var(--line)" }}>
                  <span className="small">没有未填项了。</span>
                </div>
              ) : (
                pending.map((item) => (
                  <div
                    key={`${item.field}-${item.ask}`}
                    className="row between wrap"
                    style={{
                      gap: 16,
                      padding: "16px 0",
                      borderBottom: "1px solid var(--line)",
                    }}
                  >
                    <div style={{ flex: "1 1 320px", minWidth: 0 }}>
                      <div className="row wrap" style={{ gap: 8, alignItems: "baseline" }}>
                        <span className={item.blocking ? "tag red" : "tag"}>
                          {item.blocking ? "阻塞" : item.label}
                        </span>
                        <span className="fs-13">{item.ask}</span>
                      </div>
                      {item.why && <div className="small mt-8">{item.why}</div>}
                    </div>
                    {EDITABLE.has(item.field) ? (
                      <span className="small muted">上面填写</span>
                    ) : (
                      <button
                        className="pill sm"
                        type="button"
                        onClick={() => go("upload")}
                      >
                        去改经历
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            {editable.length === 0 && rest.length > 0 && (
              <p className="small mt-16">
                剩下的都是经历本身的问题（时间、数字），改「主观经历」或重新上传简历后清单会重算。
              </p>
            )}
          </>
        )}

        {state === "loading" && (
          <div className="panel mt-32">
            <div className="eyebrow">清单</div>
            <p className="h3 mt-8">正在向后端读取待补项……</p>
          </div>
        )}
      </main>

      <Band
        step={1}
        total={4}
        label={state === "ready" ? `个人信息 · 待补 ${pending.length} 项` : "个人信息 · 补全清单"}
        action={{ label: "去岗位页", onClick: () => go("jobs") }}
      />
    </div>
  );
}
