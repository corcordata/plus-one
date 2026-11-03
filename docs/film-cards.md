# 观影卡

一起看过的每部片一张卡：哪天看的、什么日子、她挑出来的几句弹幕、两个人的观后感、「记得这几件事」。
以后她一提到片名，卡就递到他手上——他不会再把一起看过的片记成「还没看」。

播放器只管**收**：一场结束时把这一包交给你的前端（叫醒接口，原因 `wrap_up`），并在本机
`~/.plus-one/films/` 留一份备份。**卡存在前端**：他在自己家里写观后感，带着全部记忆；
每轮对话的上下文也是前端拼的，「提到片名就想起来」只能在前端做。

## 一场结束：`wrap_up`

她在抽屉里点「结束这一场」，选：

- **改天再看**（`finished: false`）：记下网址和看到哪；再打开同一个网址，播放器会问「上次看到 1:02:13，接着看吗？」。
- **看完了，收进观影卡**（`finished: true`）。

大管家 POST 到 `wake_url`：

```json
{
  "session": "2026-10-20T09-54-03",
  "reason": "wrap_up",
  "reasons": ["wrap_up"],
  "title": "穿普拉达的女王",
  "url": "https://…/play/42",
  "finished": false,
  "position": "26:39",
  "position_sec": 1599,
  "date": "2026-10-20",
  "occasion": "第一次用陪看",
  "her_review": "",
  "picked": [
    { "who": "him", "at": "8:02", "text": "Miranda 刚说了那句 That's all." },
    { "who": "her", "at": "20:25", "text": "我好期待她的 makeover" }
  ],
  "frames": [{ "id": "f3", "at": "20:33", "image": "<JPEG base64>" }],
  "playing": false, "subtitles": [], "user_said": [], "heard": ""
}
```

- `title`：从网页标题自动抠掉「-免费在线观看-xx 站」这类尾巴，她还能在面板里改。
- `picked`：这场她勾下来的弹幕，`who` 是 `her` / `him`。
- `frames`：这场递给他看过的图里挑的三张以内（开头、中间、最后）。
- 同一部片分几晚看：每晚一个 `wrap_up`，前端按网址或片名并进同一张卡、记成一场。

回复随意（直接回、`202` 都行），这一场已经结束了。

## 接着看：`resumed_from`

她从「接着看」进来时，这一场**第一眼**的门铃里多一个字段 `"resumed_from": "26:39"`。
前端看到它，可以把这部片的卡一起递给他——他就知道上次看到哪、聊过什么。

## 卡的标准格式

```json
{
  "id": 7,
  "title": "穿普拉达的女王",
  "aliases": ["The Devil Wears Prada", "时尚女魔头"],
  "status": "watching",
  "url": "https://…/play/42",
  "position_sec": 1599,
  "sessions": [
    { "date": "2026-10-20", "occasion": "第一次用陪看", "her_review": "", "picked": [ … ], "frames": [ … ] }
  ],
  "his_review": "……",
  "remember": [
    { "text": "她说 Nate 才是全片最大的反派", "by": "him" },
    { "text": "我们约好看完再聊 Andy 的结局", "by": "her" }
  ]
}
```

- `status`：`watching`（看到一半）/ `finished`。
- `remember`：「记得这几件事」，三到五条，主要是他写的；**她改过的（`by: "her"`）他不能动**。
- 别名由他补：中文名、英文名、大家常叫的名字，提到哪个都能对上。

## 前端要做的三件事

1. **存卡**：收到 `wrap_up` 就按网址或片名找卡，没有就新建，再加一场。
2. **叫他写**：叫醒他写他的观后感、「记得这几件事」、别名。要不要另外存进记忆库，让他自己定。
3. **提到片名就递卡**：每轮对话前用 [`cards/match.js`](../cards/match.js) 的 `matchCards(cards, text, already)`
   从她这句话里认片名，把卡的要点（哪天、什么日子、看到一半停在哪、记得这几件事）塞进他的上下文。
   **同一段上下文递过的不再递**：递过的 id 放进 `already`，上下文被压缩 / 清空时清零。

作者自家的前端就是照这三件事接的。

## 致谢

- 「提到片名就把卡递给他」的做法借自 lorecards-mcp（关键词触发的人物卡）。
