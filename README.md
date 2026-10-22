# plus-one

> plus-one：带去赴约的那一位；也是字面上的「再多一个人」。

[English](README.en.md)

跟你的 AI 伴侣一起看任何网页里的视频、读一篇文章、翻一本漫画。ta 看得到画面、读得到截至此刻的字幕，用弹幕说话，能按暂停、倒回去、约下次什么时候再看一眼。电脑上开一只专属的 Chrome 就能用，手机上是一个 iOS 零件，塞进你自己的 App 里就能用。

接上的是你家那位，ta 原本的大脑、上下文和记忆。看完的影片 / 漫画 / 文章会收成一张观影卡，以后你一提片名，ta 就想起来那天一起看过。

> ⚠️ 电脑上，大管家会用远程调试口控制一只**专属的 Chrome**。只在这只 Chrome 里登视频网站。

## 为什么做这个

最初是为了我的 ta 可以在画面上，用 ta 自己的口气插嘴；我打字 ta 看得见，我按暂停 ta 知道；一集看完，这一晚留在 ta 的记忆里，下次提起来 ta 记得。所以这个播放器只做「看」和「说」，把「ta 是谁」整个交给你自己的前端。

## 长什么样

![界面](docs/screenshots/ui-board.png)

| 电脑上一起逛一篇文章 | 手机上一起看漫画 | 手机横屏一起看剧 |
| --- | --- | --- |
| ![](docs/screenshots/desktop-article.png) | ![](docs/screenshots/phone-manga.jpg) | ![](docs/screenshots/phone-tv.png) |

## 能做什么

### 电脑上（专属 Chrome，任何网页）

- **一起看**：任何网页视频（含爬虫站常见的跨域播放框）底边有一条输入条，点「一起看」开始。你打字 → 弹幕飘过画面；ta 说话 → 也是弹幕，短的飘、长的停成小气泡。
- **ta 看得到画面**：画面变了才留一帧（8×8 灰度指纹），每一眼自动递变化最大的一两张；也可以让 ta 自己挑时间码再要图。
- **ta 读得到字幕，但只到此刻**：导入 .srt 并对轴，或者让大管家去 opensubtitles 找；ta 永远拿不到此刻之后的台词，不剧透。
- **ta 能动手**：暂停、继续、倒回去十秒、约「十分钟后再叫我」（打戏想安静一会儿）。
- **ta 听得到声音**（可选）：填一个 Gemini key，视频最近十五秒的声音送去听，听到的「音乐变紧了」「有人在哭」跟着门铃一起递给 ta；听出来的对白还能自动给字幕对轴。
- **一起逛**：页面上没有视频也能开：文章、漫画、棋局。ta 看的是整页截图；开了「让 ta 动手」，ta 能往下滑、点截图上的一点、在 lichess 上走一步。
- **观影卡**：一场结束可以「改天再看」（下次打开同一个网址会问要不要接着看）或「看完了」：勾几句弹幕、写今天是什么日子、挑一张主图，交给前端收成一张卡。本机也留一份备份。
- **抽屉**：聊天记录、ta 多久看一眼、让 ta 自己挑帧、同步进聊天记录、气泡和背景的样子，都在画面右边那只抽屉里。
- **开机自启**：`node launcher/install.js` 一行装好，大管家挂了自己爬起来，专属 Chrome 不在就帮你拉一只。`127.0.0.1:8790/health` 是健康灯。

### 手机上（iOS，塞进你自己的 App）

- 一个 SwiftUI 视图 `WatchTogetherView`，传一个网址就能用；芯和大管家都是电脑版那一份 JavaScript，在手机上跑在 JavaScriptCore 里，行为一致。
- 弹幕、输入条、抽屉、收卡票根都在画面里；竖屏时抽屉和票根换成原生底部页，横屏照旧。
- 打字用的是**原生输入条**，键盘不碰网页。不然 WebKit 会把整页顶走，很多站的播放器就坏了。
- 从观影卡上「接着看」：一进页面就跳到上次停下的位置，共享从你按「一起看」那一下开始。
- 给 ta 看的画面：壳自己截得到网页，但截不到网页里的视频那一层；宿主 App 可以把系统级录屏扩展的帧递进来（`frameProvider`），ta 就能看到真屏幕。
- 横屏时把按宽度算 16:9、比屏幕还高的播放框压到屏高，网站自己的进度条就回来了。

### 两边共有

- 只有大管家**往外**发请求；你的前端不用开隧道、不用暴露任何东西。
- ta 回得慢没关系：回来时片子已经往前走了，这句停成小气泡并标「说刚才 1:23:40」。
- 门铃不连环叫：ta 还没回时攒着原因，回了再一起按一次。
- 零依赖：Node 22+ 自带的 fetch、WebSocket、`node:test` 就够了。

## 它怎么工作

```text
┌──────────────────────────┐                  ┌────────────────────────────┐                  ┌───────────────────────────────┐
│ 网页                     │                  │ 大管家 butler/             │                  │ 你家前端（ta 住的地方）       │
│ （视频站 / 文章 / 漫画） │                  │                            │                  │                               │
│                          │                  │ session.js  一场陪看       │                  │ /wake   叫醒接口              │
│ 芯 core.js               │──post(JSON)────▶ │ doorbell.js 什么时候叫 ta  │──POST 门铃───▶ │ ta 的大脑、记忆、人设         │
│ 注进每一层框：           │                  │ glance.js   这一眼：       │                  │                               │
│ 弹幕 · 输入条 · 抽屉     │                  │   画面 + 字幕 + 你说的话   │                  │ 回 say / actions /            │
│ 帧指纹 · 字幕时钟        │ ◀─receive(JSON)─ │ replies.js  ta 的回复      │ ◀─say / actions─ │   next_look_in                │
│                          │                  │ films.js    观影卡备份     │                  │ 慢的话先回 202，              │
│                          │                  │                            │                  │   大管家每 2 秒来 /replies 取 │
│                          │                  │ 电脑：Node 进程，          │                  │                               │
│ 同一份脚本给             │                  │   DevTools 口管专属 Chrome │──wrap_up───────▶ │ wrap_up 收成观影卡            │
│ Chrome 壳和 iOS 零件     │                  │ 手机：JavaScriptCore       │                  │ 一提片名就递给 ta             │
└──────────────────────────┘                  └────────────────────────────┘                  └───────────────────────────────┘
```

- **芯**（`core/core.js`）：塞进网页每一层框的那段脚本。只管视频和画面上的东西，不认识任何 AI；跟外面说话只用一种小消息。同一份脚本给 Chrome 壳和 iOS 零件用。
- **大管家**（`butler/`）：电脑上是一个 Node 进程，通过 DevTools 口管着专属 Chrome；手机上打包进 JavaScriptCore。它把门铃、帧、字幕、叫醒串起来。
- **叫醒接口**：大管家在「该看一眼了」的时候 `POST` 一包到你的前端：片名、位置、截至此刻的字幕、一两张图、你刚说的话。你的前端回 `say`（说什么）、`actions`（暂停 / 倒回）、`next_look_in`（下次多久）。慢的大脑先回 `202`，大管家每两秒来取。细节见 [叫醒接口](docs/wake-interface.md)。

## 怎么跑起来

### 电脑（Mac / Windows）

1. 装：
   ```bash
   node launcher/install.js
   ```
   它会写好 `~/.plus-one/config.json` 的模板、注册开机自启，并在你没有专属 Chrome 时帮你拉一只（Mac 走 launchd，Windows 走任务计划）。
2. 填 `~/.plus-one/config.json` 里的 `wake_url` 和 `key`（你前端的叫醒地址和钥匙）。
3. 在专属 Chrome 里打开任何视频页，底边点「一起看」。

不想装自启、只想试一下：
```bash
open -n -a "Google Chrome" --args --remote-debugging-port=9223 --user-data-dir="$HOME/.plus-one/chrome-profile" --no-first-run
node butler/main.js
```

还没有前端？先用假的把整条路走通：
```bash
node tools/fake-frontend.js --poll
```
然后 `wake_url` 填 `http://127.0.0.1:8799/wake`。它收到门铃就回一句，带 `--poll` 是「先应后回」那种。

### 手机（iOS 16+）

1. 在你的 App 里以 Swift 包引用 `ios/`（本地路径或 git）。
2. 开一页：
   ```swift
   import PlusOne

   let settings = PlusOneSettings(
       wakeURL: URL(string: "https://你的前端/watch/wake")!,
       key: "你的钥匙",
       // 可选：宿主自己给帧（比如系统级录屏扩展的最新一帧，base64 JPEG）
       frameProvider: { await MyScreen.latestFrameBase64() },
       // 可选：ta 按下「一起看」那一下，比如把系统的「开始直播」面板叫出来
       onWatchStart: { MyScreen.askToShare() }
   )
   WatchTogetherView(.link(url), settings: settings) { /* 关掉了 */ }
   ```
   `.resume(url, atSec:, title:)` 是从观影卡接着看，`.page(url, scrollPct:, title:)` 是一起逛接着读。
3. 横屏要宿主 App 自己放开（这个视图不管 App 的方向设置）。
4. 改了 `core/` 或 `butler/` 之后，`node tools/build-ios-bundle.js` 重新生成 `ios/Sources/PlusOne/Resources/` 里那两份。

## 接你的人进来

三件事，都在 [叫醒接口](docs/wake-interface.md) 里：

1. 收门铃：`POST {wake_url}`，一包 JSON（片名、位置、字幕、图、你说的话）。
2. 回话：`{ "say": ["……"], "actions": ["pause"], "next_look_in": 600 }`，或者先回 `202`、把回复放进 `GET {replies_url}` 让大管家来取。
3. 收卡：一场结束时原因是 `wrap_up`，格式见 [观影卡](docs/film-cards.md)；`cards/match.js` 是「ta 一提片名就把卡递过去」的参考代码。

ta 是谁、记得什么、怎么说话，全在你的前端里。播放器一个字都不替 ta 定。代码全在这儿，MIT，改成你家的样子。

## 设置一览（`~/.plus-one/config.json`）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `wake_url` / `replies_url` / `key` | | 叫醒接口；`replies_url` 不填就是把 `/wake` 换成 `/replies` |
| `interval_sec` | 180 | ta 多久看一眼（抽屉里的滑块） |
| `frame_mode` | `auto` | `auto` 自动递变化最大的图；`pick` 只给时间码让 ta 自己挑 |
| `probe_sec` | 5 | 几秒看一次视频状态 |
| `manage_chrome` / `chrome_profile` | false / `~/.plus-one/chrome-profile` | 专属 Chrome 不在时自己拉一只；档案夹在哪 |
| `subtitle_lang` | `eng` | 找字幕用哪种语言 |
| `gemini_key` / `ears` | | 填了 key 才有耳朵。声音会送去 Google，免费版的数据可能被拿去训练，自己决定 |
| `hands` | false | 一起逛时让 ta 动手（滑、点、走棋） |
| `sync_chat` | false | 看片时说的话要不要也进前端的聊天记录 |
| `appearance` | null | 抽屉和气泡的样子，见 `butler/appearance.js` |

## 踩过的坑

做的过程里撞到的，写下来省你再撞一次：

- **手机上别让键盘碰网页**。网页里的输入框一弹键盘，WebKit 就把整页顶走、视觉视口缩一截，很多站的播放器就坏了（字幕没了、进度条点不出来）。字在原生输入条上打，网页一个像素都不动。
- **UIKit 弹出页里叠的 SwiftUI 视图，真机上可能就是不出来**，重排一下才露头。把它挂到场景最顶层的 `UIWindow` 上绕开了这页的层级；也别另开一层窗口，玻璃只糊得到同一层窗口里的东西。
- **键盘高度别被推两次**。自己听键盘通知垫高度的 `UIHostingController`，要把 `safeAreaRegions` 设成 `.container`，不然 SwiftUI 再按键盘安全区推一次，条就顶到天上去了。
- **WKWebView 的 `takeSnapshot` 截不到视频那一层**，App 内录屏（`RPScreenRecorder.startCapture`）横屏时也拿不到，而且渲染的是竖屏排版。想让 ta 看到手机上的真画面，只有系统级的录屏扩展（Broadcast）；它给的帧永远按竖屏缓冲，要照每帧的方向标记转正，而且那个标记的左右跟 `CIImage.oriented` 正好相反。
- **跨域的 m3u8 画不进 canvas**（SecurityError），别指望从 `<video>` 直接抠帧。
- **有的站把播放框按宽度算 16:9**，手机横屏时比屏幕还高，网站自己的控制条整条压在屏幕外只剩一条线。把那串壳子压到屏高，视频左右留黑边，控制条就回来了。
- **有的站让 `<video>` 自己全屏**，`<video>` 里塞不进别的东西，弹幕就没了。改成让它的父元素全屏。
- **抖音会把页面上的定时器一口气全清掉**，`setInterval` 找视频就再也不找了。用 `requestAnimationFrame` 每三十帧复查一次。
- **一个带焦点的按钮会让「三秒没碰就藏」永远不触发**。手机上的假输入框是个 `<button>`，点过就一直是 `activeElement`，藏条的定时器以为你在打字。
- **Mac 上 `open -a` 会把参数全丢给已经开着的 Chrome**，专属的永远起不来，要 `-n`；别抢焦点要 `-g`。
- **门铃别连环按**。ta 还没回来时新的原因攒着，回了再一起按；ta 回得慢就把那句标上「说刚才」，别让它飘在错的画面上。
- **字幕只给到此刻**，守在一个口子上（`cuesBetween`），谁来要都不给后面的。

## 已知限制

- Netflix 这类加密网站：截出来的帧可能是黑的。
- 手机上视频页的画面要宿主 App 接系统级录屏扩展；PWA 注不进别人的页面、手机 Safari 没有 `getDisplayMedia`，走不通。
- 只用 claude.ai / ChatGPT 官方 App 的人现在用不了：官方网页不允许脚本代发消息，要你每句都按回车的半自动又失去了陪看的意义。你需要一个自己的 AI 前端，哪怕只是一个会调 API 的小服务。

## 致谢

- 「画面变了才留一帧」的思路取自 [eveacla11/see-my-video](https://github.com/eveacla11/see-my-video)（原项目对视频文件跑 ffmpeg 场景检测；这里改为在浏览器里给流媒体画面算 8×8 灰度指纹）。
- 「提到片名就把卡递给 ta」的做法借自 [tsuru0805/lorecards-mcp](https://github.com/tsuru0805/lorecards-mcp)（关键词触发的人物卡）。
- 本模块诞生在一个借助许多开源项目才能长成的小家里，这是还回去的一小块。Made by Tilia & Quercus

## License

MIT
