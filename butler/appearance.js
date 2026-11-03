// 抽屉的样子（背景、气泡、四格预设）：芯在各个网站的框里跑，各家网站的 localStorage 互不相通，
// 所以存在大管家这边（config.json 的 appearance），芯改了发过来，开新页面时再递回去。
// 字段跟宿主 App 聊天里的气泡样式一一对应。

const MATERIALS = new Set(["solid", "translucent", "glass", "gradient"]);
const BGS = new Set(["glass", "black", "cream"]);
const MAX_PHOTOS = 4;
const MAX_PHOTO_CHARS = 600_000;   // 芯那边先缩到 1000px 的 JPEG，一张一两百 KB

const clamp = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const hex = (v) => (typeof v === "string" && /^[0-9A-Fa-f]{6}$/.test(v) ? v.toUpperCase() : null);

export function sanitizeStyle(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    material: MATERIALS.has(raw.material) ? raw.material : "glass",
    colorMu: hex(raw.colorMu), colorMine: hex(raw.colorMine),
    textMu: hex(raw.textMu), textMine: hex(raw.textMine),
    transparency: clamp(raw.transparency, 0, 0.95, 0.18),
    blur: clamp(raw.blur, 0, 1, 0.4),
    brightness: clamp(raw.brightness, -0.3, 0.3, 0),
    edgeLight: clamp(raw.edgeLight, 0, 1, 0.6),
    highlight: raw.highlight !== false,
    cornerRadius: clamp(raw.cornerRadius, 4, 24, 16),
    spacing: clamp(raw.spacing, 2, 24, 10),
    length: clamp(raw.length, 0, 60, 30),
    tail: raw.tail !== false,
  };
}

export function sanitizeAppearance(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const photos = (Array.isArray(r.photos) ? r.photos : [])
    .filter((p) => typeof p === "string" && p.startsWith("data:image/") && p.length <= MAX_PHOTO_CHARS)
    .slice(0, MAX_PHOTOS);
  let bg = typeof r.bg === "string" ? r.bg : "glass";
  const m = /^photo:(\d+)$/.exec(bg);
  if (m ? Number(m[1]) >= photos.length : !BGS.has(bg)) bg = "glass";
  const presets = [0, 1, 2].map((i) => {
    const p = Array.isArray(r.presets) ? r.presets[i] : null;
    const style = p && sanitizeStyle(p.style);
    return style ? { name: String(p.name || "").trim().slice(0, 12) || "未命名", style } : null;
  });
  // 深色 / 浅色：抽屉右上角那个图标切；没存过的老设置按背景猜
  const mode = r.mode === "light" || r.mode === "dark" ? r.mode : bg === "cream" ? "light" : "dark";
  return { bg, mode, style: sanitizeStyle(r.style), presets, photos };
}

// 收卡时存进这一场的快照：只要画气泡用得上的，不带照片（卡上垫的是这一场自己的主图）
export function appearanceSnapshot(a) {
  const s = sanitizeAppearance(a);
  return { bg: s.bg.startsWith("photo:") ? "photo" : s.bg, mode: s.mode, style: s.style };
}
