// 观影卡 · 认片名（给前端作者照着用的参考代码）
// 她这句话里提到了哪部一起看过的片 → 那张卡递给他。中文按字面找，纯英文按整词找
//（Up 不能撞 upstairs），不分大小写，按在句子里出现的先后。
// 同一段上下文递过的卡放进 already，别重复递；上下文被压缩 / 清空后再清零。
// 这一招借自 lorecards-mcp（关键词触发的人物卡）。

export function keywordsOf(card) {
  const out = [];
  for (const k of [card.title, ...(card.aliases || [])]) {
    const s = String(k || "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

function position(keyword, text) {
  const k = keyword.toLowerCase();
  const t = text.toLowerCase();
  if (/^[a-z0-9 .'&:!?-]+$/.test(k)) {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).exec(t);
    return m ? m.index : -1;
  }
  return t.indexOf(k);
}

export function matchCards(cards, text, already = new Set(), limit = 2) {
  if (!text) return [];
  const hits = [];
  for (const card of cards) {
    if (already.has(card.id)) continue;
    const at = keywordsOf(card).map((k) => position(k, text)).filter((i) => i >= 0);
    if (at.length) hits.push({ at: Math.min(...at), card });
  }
  return hits.sort((a, b) => a.at - b.at).slice(0, limit).map((h) => h.card);
}
