const ATOM = /^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+$/u;
const LABEL = /^[\p{L}\p{N}]([\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u;
const TLD = /^\p{L}{2,}$/u;

/**
 * 邮箱格式预检，和后端 `auth.clean_email` 保持同一条底线：本地部分是若干
 * 用点分隔的原子，域名是若干非空标签、后缀至少两个字母。
 *
 * 这里只是把「连 @.com 都没有」的输入在按下按钮之前挡下来，不用等 422；
 * 后端的校验才是最终裁决。
 */
export function emailLooksValid(value: string): boolean {
  const email = value.trim().toLowerCase();
  const parts = email.split("@");
  if (parts.length !== 2 || email.length > 254) return false;
  const [local, domain] = parts as [string, string];
  if (!local || local.length > 64) return false;
  if (!local.split(".").every((atom) => ATOM.test(atom))) return false;

  const labels = domain.split(".");
  return (
    labels.length >= 2 &&
    labels.every((label) => LABEL.test(label)) &&
    TLD.test(labels[labels.length - 1] ?? "")
  );
}
