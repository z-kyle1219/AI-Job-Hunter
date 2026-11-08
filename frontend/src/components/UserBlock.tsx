import { useEffect, useRef, useState } from "react";
import { useProfile } from "../store";
import type { Route } from "../App";

type Props = {
  onLogin: () => void;
  go: (r: Route) => void;
};

export default function UserBlock({ onLogin, go }: Props) {
  const { user, signOut } = useProfile();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) {
    return (
      <button className="pill sm" onClick={onLogin} type="button">
        登录
      </button>
    );
  }

  return (
    <div className="account" ref={box}>
      <button
        className="account-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`账户：${user.name}`}
        type="button"
      >
        <span className="avatar" aria-hidden="true">
          {user.name.slice(0, 1)}
        </span>
        <span className="account-name">{user.name}</span>
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="account-pop" role="dialog" aria-label="账户">
          <div className="account-head">
            <span className="avatar lg" aria-hidden="true">
              {user.name.slice(0, 1)}
            </span>
            <div style={{ flex: 1 }}>
              <div className="eyebrow">已登录</div>
              <div className="h3" style={{ fontSize: 15 }}>
                {user.name}
              </div>
            </div>
          </div>

          <div className="account-meta">
            <span className="eyebrow">账号</span>
            <span className="fs-13">{user.account ?? "未绑定邮箱"}</span>
          </div>

          <div className="account-links">
            <button
              className="linkish"
              type="button"
              onClick={() => {
                setOpen(false);
                go("profile-info");
              }}
            >
              个人信息补全
            </button>
            <button
              className="linkish"
              type="button"
              onClick={() => {
                setOpen(false);
                go("upload");
              }}
            >
              上传信息
            </button>
            <button
              className="linkish"
              type="button"
              onClick={() => {
                setOpen(false);
                go("report");
              }}
            >
              查看报告
            </button>
            <button
              className="linkish"
              type="button"
              onClick={() => {
                setOpen(false);
                signOut();
              }}
            >
              退出登录
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
