// 片名：网页标题常带着「-免费在线观看-爱看机器人-ikanbot.com」这类尾巴，抠掉。
// 她在收卡面板里还能改，这里只求八九不离十。
// 光秃秃的「-」只在挨着中文时才算分隔——不然 Spider-Man 会被切成 Spider
const SEP = /\s+[-–—|]\s+|[_|–—]|(?<=[\u4e00-\u9fff])-|-(?=[\u4e00-\u9fff])/;
const TAIL = /(免费|在线|观看|高清|影视|影院|电影网|视频|播放|爱看机器人|youtube|bilibili|哔哩哔哩|netflix|\.(com|cc|tv|net|org|me|io|vip|top)\b)/i;

export function cleanTitle(pageTitle) {
  const raw = String(pageTitle || "").trim();
  if (!raw) return "";
  const parts = raw.split(SEP).map((p) => p.trim()).filter(Boolean);
  const kept = parts.filter((p) => !TAIL.test(p));
  return kept[0] || raw;
}
