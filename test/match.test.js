import { test } from "node:test";
import assert from "node:assert/strict";
import { matchCards, keywordsOf } from "../cards/match.js";

const cards = [
  { id: 1, title: "穿普拉达的女王", aliases: ["The Devil Wears Prada", "时尚女魔头"] },
  { id: 2, title: "About Time", aliases: ["时空恋旅人"] },
  { id: 3, title: "Up", aliases: ["飞屋环游记"] },
];

test("keywords are title plus aliases, deduped", () => {
  assert.deepEqual(keywordsOf({ title: "Up", aliases: ["Up", "飞屋环游记"] }), ["Up", "飞屋环游记"]);
});

test("Chinese by substring, English by whole word, in order of mention", () => {
  assert.deepEqual(matchCards(cards, "时空恋旅人和时尚女魔头哪个好看").map((c) => c.id), [2, 1]);
  assert.deepEqual(matchCards(cards, "we watched about time on our 100th day").map((c) => c.id), [2]);
  assert.deepEqual(matchCards(cards, "cheer up").map((c) => c.id), [3]);
  assert.deepEqual(matchCards(cards, "upstairs").map((c) => c.id), []);
});

test("skips cards already handed over in this context, caps the count", () => {
  assert.deepEqual(matchCards(cards, "时尚女魔头", new Set([1])), []);
  assert.equal(matchCards(cards, "穿普拉达的女王 About Time 飞屋环游记", new Set(), 2).length, 2);
  assert.deepEqual(matchCards(cards, ""), []);
});
