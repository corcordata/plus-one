// 找字幕：opensubtitles.org 的老接口，不用账号（跟不少人平时手动找的是同一个站）。
// 搜 → 按「同一部片、年份对、下载多、带 SDH 的优先」排好列给她挑 → 下载解压、剔广告、按原编码解码。
// SDH / HI = 给听障观众的版本，音效也写出来（[笑声]、[门响]），他「听」得更多，所以排前面。
import { gunzipSync } from "node:zlib";
import { parseSrt } from "./subtitles.js";

const UA = "TemporaryUserAgent";   // 老接口认这个，不用登录
const BASE = "https://rest.opensubtitles.org/search";
const AD = /opensubtitles|osdb\.link|advertise your product|become vip|www\.[a-z0-9-]+\.[a-z]{2,}/i;
const ENCODINGS = { CP1252: "windows-1252", CP1250: "windows-1250", CP1251: "windows-1251", GB2312: "gbk", GBK: "gbk",
  BIG5: "big5", "UTF-8": "utf-8", "ISO-8859-1": "latin1" };

const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function searchUrl(query, lang = "eng") {
  return `${BASE}/query-${encodeURIComponent(String(query).trim().toLowerCase())}/sublanguageid-${encodeURIComponent(lang)}`;
}

// 接口回来的一大串 → 候选（最多 limit 条）。主片 = 片名最像、下载最多的那部；续集 / 同名别的片排后面，带年份让她分得清
export function rankCandidates(raw, query, limit = 8) {
  const q = norm(query);
  const items = (Array.isArray(raw) ? raw : [])
    // 分成两张碟（CD1 / CD2）的老字幕：挑一条只有半部片，不要
    .filter((x) => x && x.SubDownloadLink && (x.SubFormat || "srt") === "srt" && x.MovieKind !== "episode"
      && !(Number(x.SubSumCD) > 1))
    .map((x) => ({
      id: String(x.IDSubtitleFile),
      movie: x.MovieName || "",
      year: Number(x.MovieYear) || null,
      imdb: String(x.IDMovieImdb || ""),
      name: x.MovieReleaseName || x.SubFileName || "",
      hi: x.SubHearingImpaired === "1",
      downloads: Number(x.SubDownloadsCnt) || 0,
      link: x.SubDownloadLink,
      encoding: x.SubEncoding || "",
      exact: norm(x.MovieName) === q,
    }));
  const byMovie = new Map();
  for (const it of items) byMovie.set(it.imdb, (byMovie.get(it.imdb) || 0) + it.downloads + (it.exact ? 1e9 : 0));
  const main = [...byMovie.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return items
    .sort((a, b) => (b.imdb === main) - (a.imdb === main) || b.hi - a.hi || b.downloads - a.downloads)
    .slice(0, limit)
    .map(({ exact, ...rest }) => rest);
}

export function decodeSubtitle(buf, encoding = "") {
  const label = ENCODINGS[String(encoding).toUpperCase()] || "utf-8";
  let text;
  try { text = new TextDecoder(label).decode(buf); } catch { text = new TextDecoder("utf-8").decode(buf); }
  return text.replace(/^﻿/, "");
}

// 字幕站往字幕里夹的广告那几句剔掉，剩下的照常解析
export function cleanCues(cues) {
  return cues.filter((c) => !AD.test(c.text));
}

export class SubFinder {
  constructor({ fetchImpl = fetch, lang = "eng" } = {}) {
    this.fetch = fetchImpl;
    this.lang = lang;
  }

  async search(query) {
    if (!String(query || "").trim()) return [];
    const res = await this.fetch(searchUrl(query, this.lang), {
      headers: { "User-Agent": UA, "X-User-Agent": UA }, signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`字幕站 ${res.status}`);
    return rankCandidates(await res.json(), query);
  }

  async download(cand) {
    const res = await this.fetch(cand.link, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`下载 ${res.status}`);
    let buf = Buffer.from(await res.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
    return cleanCues(parseSrt(decodeSubtitle(buf, cand.encoding)));
  }
}
