// 门铃：什么时候叫醒他。
// 上一次他还没回，新的原因只攒着、不重复叫——不然他会被连环叫醒，钱也烧得快。
// 他回了再把攒着的一起按一次。他自己约的下次（next_look_in）优先于滑块。
export class Doorbell {
  constructor({ intervalSec = 180, replyTimeoutSec = 120 } = {}) {
    this.intervalSec = intervalSec;
    this.replyTimeoutSec = replyTimeoutSec;
    this.pendingSince = null;
    this.queued = [];
    this.nextTickAt = null;
    this.scheduled = false;
  }

  start(nowMs) {
    this.nextTickAt = nowMs + this.intervalSec * 1000;
    this.scheduled = false;
  }

  setInterval(sec, nowMs) {
    this.intervalSec = sec;
    this.nextTickAt = nowMs + sec * 1000;
    this.scheduled = false;
  }

  ring(reason, nowMs) {
    this._expire(nowMs);
    if (this.pendingSince !== null) {
      if (!this.queued.includes(reason)) this.queued.push(reason);
      return null;
    }
    const reasons = [...this.queued.filter((r) => r !== reason), reason];
    this.queued = [];
    this.pendingSince = nowMs;
    return reasons;
  }

  check(nowMs, playing) {
    if (!playing || this.nextTickAt === null || nowMs < this.nextTickAt) return null;
    const reason = this.scheduled ? "scheduled" : "tick";
    this.scheduled = false;
    this.nextTickAt = nowMs + this.intervalSec * 1000;
    return this.ring(reason, nowMs);
  }

  replied(nowMs, nextLookIn = null) {
    const wasPending = this.pendingSince !== null;
    this.pendingSince = null;
    if (typeof nextLookIn === "number") {
      this.nextTickAt = nowMs + nextLookIn * 1000;
      this.scheduled = true;
    } else if (wasPending) {
      this.nextTickAt = nowMs + this.intervalSec * 1000;
      this.scheduled = false;
    }
    if (!this.queued.length) return null;
    const reasons = this.queued;
    this.queued = [];
    this.pendingSince = nowMs;
    return reasons;
  }

  _expire(nowMs) {
    if (this.pendingSince !== null && nowMs - this.pendingSince > this.replyTimeoutSec * 1000) {
      this.pendingSince = null;
    }
  }
}
