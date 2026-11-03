# 叫醒接口

陪看播放器（大管家）在「该看一眼了」的时候叫醒你的 AI，把这一眼递过去；你的 AI 回话、动手。
**全程只有大管家往外发请求**，你的前端不用开隧道、不用暴露任何东西。

## 配置

在 `~/.plus-one/config.json` 填：

| 字段 | 说明 |
| --- | --- |
| `wake_url` | 叫醒地址，大管家 POST 到这里 |
| `replies_url` | 先应后回时取回复的地址；不填就是把 `wake_url` 结尾的 `/wake` 换成 `/replies` |
| `key` | 你前端发的钥匙，大管家每次带 `Authorization: Bearer <key>` |

## 门铃：大管家 → 你

`POST {wake_url}`，`Content-Type: application/json`：

```json
{
  "session": "2026-10-20T08-12-03",
  "reason": "user_message",
  "reasons": ["user_message", "tick"],
  "title": "片名（网页标题）",
  "position": "1:23:45",
  "position_sec": 5025.3,
  "playing": true,
  "subtitles": [{ "at": "1:21:10", "text": "You shouldn't be here." }],
  "frames": [
    { "id": "f12", "at": "1:23:02", "image": "<JPEG base64>" },
    { "id": "f13", "at": "1:23:30" }
  ],
  "heard": "",
  "user_said": [{ "at": "1:23:30", "text": "这人好装" }]
}
```

- `reason`：`tick`（滑块到点）、`user_message`（她发了弹幕，立刻叫）、`paused`（她按了暂停，停够 3 秒才算）、`ended`（一集放完）、`scheduled`（你约的时间到了）、`wrap_up`（这一场结束，收进观影卡，格式见 [观影卡](film-cards.md)）。上一次还没回时攒下的原因会合并进 `reasons`。
- `resumed_from`：只在「接着看」那一场的第一眼出现，是上次停下的位置。
- `subtitles`：上一眼到此刻之间开始的台词，**永远不会有此刻之后的**。
- `frames`：默认（自动递）画面变化最大的 1~2 张带 `image`，其余只有时间码。
- `heard`：Gemini 耳朵听到的（第二期；现在是空串）。

## 你 → 大管家，三种回法

**1. 直接回**：`200` + JSON：

```json
{ "say": ["这人确实装"], "actions": ["pause"], "next_look_in": 600 }
```

- `say`：一句或几句（字符串或数组，最多 5 句、每句 300 字）。≤ 20 字的飘成弹幕，长的停成小气泡。
- `actions`：`"pause"`、`"resume"`、`"seek:-10"`（或 `{"type":"seek","by":-10}`，±600 秒内）。
- `next_look_in`：下次多少秒后叫你（20~1800），比如打戏想安静十分钟。
- 什么都不带 = 不说话。

**2. 先应后回（轮询）**：叫醒一次要几十秒的大脑用这个。门铃先回 `202`，大管家每 2 秒：

`GET {replies_url}?session=<session>&after=<上次拿到的最大 id>`

```json
{ "replies": [{ "id": 41, "say": ["……"] }, { "id": 42, "actions": ["seek:-10"] }] }
```

每条跟「直接回」同样的字段，外加递增的 `id`。只返回 `id > after` 的。

**3. 用工具**（第二期）：大管家开一组带钥匙的工具（说弹幕、暂停、倒回、看某一帧、找字幕、约下次），会调工具的大脑随时伸手。

## 他回得慢

他回来时片子已经比那一眼往前走了 15 秒以上，这句不飘，停成小气泡并标「（说刚才 1:23:40）」。

## 参考实现

- 作者自家前端的接法：`/watch/wake`（先应后回）、`/watch/replies`，大脑回复以 `⟪陪看⟫` 开头即弹幕。
- `tools/fake-frontend.js`：最小的假前端，两种回法都有。
