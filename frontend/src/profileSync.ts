import { confirmProfile } from "./api";
import type { Profile } from "./types";

/**
 * 后端画像的「拿到或建立」入口。
 *
 * 岗位匹配、岗位检索、模拟面试、补全清单都要 profile_id，而这个 id 只有在
 * 用户确认过一次画像之后才存在。缺了就先走确认接口，而不是让每个页面各自
 * 拼一遍请求体。
 */
export async function ensureBackendProfile(
  profile: Profile,
  patch: (partial: Partial<Profile>) => void
): Promise<string> {
  if (profile.backendProfileId) return profile.backendProfileId;
  if (!profile.backendUserId) {
    throw new Error("还没有后端账户：请先登录，并上传一份简历。");
  }
  const created = await confirmProfile(profile);
  patch({ backendProfileId: created.id });
  return created.id;
}
