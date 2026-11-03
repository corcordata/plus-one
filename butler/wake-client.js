// 叫醒接口的客户端。全程只有这边往外发请求——前端那头不用开隧道。
import { normalizeReply } from "./replies.js";

const auth = (key) => (key ? { Authorization: `Bearer ${key}` } : {});

export async function sendWake({ wakeUrl, key, timeoutMs = 90000, fetchImpl = fetch }, glance) {
  const res = await fetchImpl(wakeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth(key) },
    body: JSON.stringify(glance),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 202) return { mode: "poll" };
  if (!res.ok) throw new Error(`wake ${res.status}`);
  const body = await res.json().catch(() => ({}));
  return { mode: "inline", reply: normalizeReply(body) };
}

// 手机叫电脑（手机那头的卡上「在电脑上接着看」）：没在陪看时也来取。只有这边往外问，不用开口子
export async function pollCommands({ commandsUrl, key, fetchImpl = fetch }, after) {
  const u = new URL(commandsUrl);
  u.searchParams.set("after", String(after));
  const res = await fetchImpl(u, { headers: auth(key), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`commands ${res.status}`);
  const body = await res.json();
  return {
    commands: (body.commands || []).map((c) => ({ ...c, id: Number(c.id) || 0 })).filter((c) => c.id > after),
    freshSec: Number(body.fresh_sec) || 120,
  };
}

export async function pollReplies({ repliesUrl, key, fetchImpl = fetch }, session, after) {
  const u = new URL(repliesUrl);
  u.searchParams.set("session", session);
  u.searchParams.set("after", String(after));
  const res = await fetchImpl(u, { headers: auth(key), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`replies ${res.status}`);
  const body = await res.json();
  return (body.replies || [])
    .map((r) => ({ id: Number(r.id) || 0, reply: normalizeReply(r) }))
    .filter((r) => r.id > after);
}
