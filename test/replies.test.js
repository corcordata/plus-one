import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeReply, lateTag } from "../butler/replies.js";

test("say accepts a string or a list, trims, caps", () => {
  assert.deepEqual(normalizeReply({ say: "  这人确实装 " }).say, ["这人确实装"]);
  const many = normalizeReply({ say: ["a", "", "b", "c", "d", "e", "f"] });
  assert.deepEqual(many.say, ["a", "b", "c", "d", "e"]);
  assert.equal(normalizeReply({ say: ["x".repeat(400)] }).say[0].length, 300);
});

test("actions accept objects or strings, drop junk, clamp seek", () => {
  const r = normalizeReply({ actions: ["pause", "seek:-10", { type: "seek", by: -9999 }, { type: "dance" }, "seek 0"] });
  assert.deepEqual(r.actions, [{ type: "pause" }, { type: "seek", by: -10 }, { type: "seek", by: -600 }]);
});

test("next_look_in is clamped to 20..1800", () => {
  assert.equal(normalizeReply({ next_look_in: 5 }).nextLookIn, 20);
  assert.equal(normalizeReply({ next_look_in: 600 }).nextLookIn, 600);
  assert.equal(normalizeReply({ next_look_in: 99999 }).nextLookIn, 1800);
  assert.equal(normalizeReply({}).nextLookIn, null);
});

test("nothing to say or do is silent", () => {
  assert.equal(normalizeReply({}).silent, true);
  assert.equal(normalizeReply(null).silent, true);
  assert.equal(normalizeReply({ say: "嗯" }).silent, false);
});

test("late tag only when the film moved on more than 30 seconds", () => {
  assert.equal(lateTag(100, 125), null);
  assert.equal(lateTag(100, 131), "1:40");
});

test("hand actions for browsing together: scroll, click (screen fractions), lichess move; junk dropped", async () => {
  const { normalizeReply } = await import("../butler/replies.js");
  const r = normalizeReply({ say: "往下看看", actions: ["scroll page", "scroll -400", "click 0.42 0.61", "move e2e4", "move e7e8q",
    { type: "click", x: 1.4, y: 0.2 }, { type: "move", uci: "z9z9" }, { type: "scroll", by: 99999 }, "click here"] });
  assert.deepEqual(r.actions, [
    { type: "scroll", by: "page" }, { type: "scroll", by: -400 }, { type: "click", x: 0.42, y: 0.61 },
    { type: "move", uci: "e2e4" }, { type: "move", uci: "e7e8q" }, { type: "scroll", by: 5000 },
  ]);
});
