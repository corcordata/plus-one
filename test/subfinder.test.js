import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { rankCandidates, searchUrl, decodeSubtitle, cleanCues, SubFinder } from "../butler/subfinder.js";
import { WatchSession } from "../butler/session.js";

// 照字幕站真回的样子缩写的几条：主片、续集、一条 SDH、一条剧集
const RAW = [
  { IDSubtitleFile: "1", MovieName: "The Devil Wears Prada", MovieYear: "2006", IDMovieImdb: "458352", MovieReleaseName: "BluRay.1080p", SubFormat: "srt", SubHearingImpaired: "0", SubDownloadsCnt: "535322", SubDownloadLink: "https://dl/1.gz", SubEncoding: "CP1252", MovieKind: "movie" },
  { IDSubtitleFile: "2", MovieName: "The Devil Wears Prada 2", MovieYear: "2026", IDMovieImdb: "999", MovieReleaseName: "WEB-DL", SubFormat: "srt", SubHearingImpaired: "0", SubDownloadsCnt: "166356", SubDownloadLink: "https://dl/2.gz", MovieKind: "movie" },
  { IDSubtitleFile: "3", MovieName: "The Devil Wears Prada", MovieYear: "2006", IDMovieImdb: "458352", MovieReleaseName: "DVDRip SDH", SubFormat: "srt", SubHearingImpaired: "1", SubDownloadsCnt: "9000", SubDownloadLink: "https://dl/3.gz", MovieKind: "movie" },
  { IDSubtitleFile: "4", MovieName: "Some Show", IDMovieImdb: "5", SubFormat: "srt", SubDownloadLink: "https://dl/4.gz", MovieKind: "episode" },
  { IDSubtitleFile: "5", MovieName: "The Devil Wears Prada", IDMovieImdb: "458352", SubFormat: "sub", SubDownloadLink: "https://dl/5.gz" },
  { IDSubtitleFile: "6", MovieName: "The Devil Wears Prada", IDMovieImdb: "458352", SubFormat: "srt", SubSumCD: "2", SubHearingImpaired: "1", SubDownloadsCnt: "99999999", SubDownloadLink: "https://dl/6.gz" },
];

test("candidates: the main film first, SDH before plain, sequels after; episodes, non-srt and two-CD splits dropped", () => {
  const c = rankCandidates(RAW, "the devil wears prada");
  assert.deepEqual(c.map((x) => x.id), ["3", "1", "2"]);
  assert.equal(c[0].hi, true);
  assert.equal(c[2].year, 2026);   // 续集带年份，她分得清
  assert.match(searchUrl("The Devil Wears Prada"), /query-the%20devil%20wears%20prada\/sublanguageid-eng$/);
});

test("subtitle text: old encodings decode, the site's ad lines are removed", () => {
  const cp1252 = Buffer.from([0x63, 0x61, 0x66, 0xe9]);   // café
  assert.equal(decodeSubtitle(cp1252, "CP1252"), "café");
  assert.equal(decodeSubtitle(Buffer.from("﻿hi"), "UTF-8"), "hi");
  const cues = [{ start: 6, end: 12, text: "Watch Online Movies for FREE www.osdb.link/lm" }, { start: 118, end: 120, text: "Good luck." }];
  assert.deepEqual(cleanCues(cues).map((c) => c.text), ["Good luck."]);
});

test("download unzips the .gz and parses it", async () => {
  const srt = "1\n00:00:06,000 --> 00:00:12,000\nwww.osdb.link ad\n\n2\n00:01:58,991 --> 00:02:00,367\nGood luck.\n";
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => gzipSync(Buffer.from(srt)) });
  const cues = await new SubFinder({ fetchImpl }).download({ link: "https://dl/x.gz", encoding: "UTF-8" });
  assert.deepEqual(cues.map((c) => c.text), ["Good luck."]);
});

test("a host without subtitle search (the phone) answers instead of throwing", async () => {
  const delivered = [];
  const s = new WatchSession({ shell: { deliver: async (m) => delivered.push(m), setActive() {}, probe: async () => ({ ok: false }) },
    wake: {}, config: { interval_sec: 180, frame_mode: "auto", gemini_key: "k" }, subfinder: null, listen: null });
  await s.handleCoreMessage({ msg: { type: "subtitles_search", query: "x" } });
  await s.handleCoreMessage({ msg: { type: "subtitles_pick", id: "1" } });
  assert.deepEqual(delivered, [{ type: "subtitle_candidates", query: "x", items: [], error: "找字幕在这里用不了" }]);
  assert.equal(s.earsAvailable(), false);   // 没耳朵就不显示那个开关
});

test("drawer search → candidates (no download links leak to the page) → pick loads the cues", async () => {
  const delivered = [];
  const finder = {
    async search(q) { return q ? rankCandidates(RAW, q) : []; },
    async download(c) { return [{ start: 1, end: 2, text: `from ${c.id}` }]; },
  };
  const s = new WatchSession({ shell: { deliver: async (m) => delivered.push(m), setActive() {}, probe: async () => ({ ok: false }) },
    wake: {}, config: { interval_sec: 180, frame_mode: "auto" }, subfinder: finder });
  await s.handleCoreMessage({ msg: { type: "subtitles_search", query: "The Devil Wears Prada" } });
  assert.equal(delivered[0].searching, true);
  const list = delivered[1];
  assert.equal(list.items.length, 3);
  assert.equal("link" in list.items[0], false);
  await s.handleCoreMessage({ msg: { type: "subtitles_pick", id: "1" } });
  assert.equal(s.rawCues[0].text, "from 1");
  assert.match(delivered.at(-1).text, /^装上了 1 句/);
});
