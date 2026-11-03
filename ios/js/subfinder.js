// 手机版的「找字幕」：电脑上那份要 Node 解压下载回来的 .gz，这里先不接，
// 他叫找字幕时老实说一声，让她从抽屉里导入 .srt。接口跟 butler/subfinder.js 的 SubFinder 一样。
export class SubFinder {
  async search() { throw new Error("找字幕在手机上还不能用，从抽屉里导入 .srt 吧"); }
  async download() { throw new Error("找字幕在手机上还不能用，从抽屉里导入 .srt 吧"); }
}
