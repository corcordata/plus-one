// 帧：画面变了才留一张。
// 「画面变了才留一帧」的思路取自 eveacla11/see-my-video（原项目对视频文件跑 ffmpeg 场景检测）；
// 这里改成在网页里给流媒体画面算 8×8 灰度指纹（芯里算），这边只比。
export const FP_THRESHOLD = 14;   // 平均灰度差超过它算「换画面了」
export const STALE_SEC = 60;      // 片子走了一分钟还没截过，不管指纹怎么说都补一张
export const FALLBACK_SEC = 20;   // 指纹算不出来（跨域 / 硬解全黑）时，按片内 20 秒一张
export const MIN_GAP_SEC = 10;    // 换画面再频繁，两张之间也至少隔 10 秒——每截一张她那边弹幕会藏一下

export function fingerprintDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

// 硬解的视频画进 canvas 是全黑——全平的指纹当作算不出来，不然「画面没变」一张都不截
export function isFlat(fp) {
  return Array.isArray(fp) && fp.length > 0 && Math.max(...fp) - Math.min(...fp) < 2;
}

export function shouldCapture({ fingerprint, lastFingerprint, time, lastShotTime }) {
  const usable = Array.isArray(fingerprint) && !isFlat(fingerprint) ? fingerprint : null;
  const sinceShot = typeof lastShotTime === "number" ? Math.abs(time - lastShotTime) : Infinity;
  if (!usable) return { capture: sinceShot >= FALLBACK_SEC, usable: null, dist: Infinity };
  const dist = fingerprintDistance(lastFingerprint, usable);
  if (sinceShot < MIN_GAP_SEC) return { capture: false, usable, dist };
  return { capture: dist >= FP_THRESHOLD || sinceShot >= STALE_SEC, usable, dist };
}

export class FrameBuffer {
  constructor(max = 12) {
    this.max = max;
    this.items = [];
    this.seq = 0;
  }

  add({ at, dist, jpeg }) {
    const id = `f${++this.seq}`;
    this.items.push({ id, at, dist, jpeg });
    if (this.items.length > this.max) this.items.shift();
    return id;
  }

  drain() {
    const all = this.items;
    this.items = [];
    return all;
  }

  // 没送出去的放回最前面，下次一起带上（还是最多留 max 张）
  restore(items) {
    this.items = [...items, ...this.items].slice(-this.max);
  }
}
