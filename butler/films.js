// 本机备份：一起看过的片，每部一个 JSON。前端还没接观影卡的人也能在这里翻到看过什么，
// 再打开同一个网址时也靠它问「上次看到 1:02:13，接着看吗」。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function filmsDir() {
  return process.env.PLUS_ONE_FILMS || path.join(os.homedir(), ".plus-one", "films");
}

const slug = (s) => String(s || "film").trim().replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 80) || "film";
const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

export class FilmStore {
  constructor(dir = filmsDir()) {
    this.dir = dir;
  }

  all() {
    let names = [];
    try { names = fs.readdirSync(this.dir).filter((n) => n.endsWith(".json")); } catch { return []; }
    const out = [];
    for (const n of names) {
      try { out.push({ file: path.join(this.dir, n), ...JSON.parse(fs.readFileSync(path.join(this.dir, n), "utf8")) }); } catch { /* 坏文件跳过 */ }
    }
    return out;
  }

  findByUrl(url) {
    if (!url) return null;
    const hit = this.all().find((r) => (r.urls || []).includes(url));
    if (!hit) return null;
    const { file, ...rec } = hit;
    return rec;
  }

  recordWrap({ title, url, pageUrl = "", finished, positionSec, occasion = "", herReview = "", picked = [], date }) {
    const found = this.all().find((r) => (url && (r.urls || []).includes(url)) || same(r.title, title));
    const { file: oldFile, ...rec } = found || { title, urls: [], sessions: [] };
    for (const u of [url, pageUrl]) if (u && !rec.urls.includes(u)) rec.urls.push(u);
    rec.status = finished ? "finished" : "watching";
    rec.position_sec = Math.round(Number(positionSec) || 0);
    rec.sessions.push({ date, occasion, her_review: herReview, picked });
    rec.updated_at = new Date().toISOString();
    fs.mkdirSync(this.dir, { recursive: true });
    const file = oldFile || path.join(this.dir, `${slug(rec.title)}.json`);
    fs.writeFileSync(file, JSON.stringify(rec, null, 2));
    return rec;
  }
}
