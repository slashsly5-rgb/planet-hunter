import test from "node:test";
import assert from "node:assert/strict";
import { isHit } from "../score.js";

const frames = [{ x: 100, y: 100 }, { x: 160, y: 100 }];
const R = 28;

test("tap on either position, or between them, is a hit", () => {
  assert.equal(isHit({ x: 100, y: 100 }, frames, R), true);
  assert.equal(isHit({ x: 160, y: 100 }, frames, R), true);
  assert.equal(isHit({ x: 130, y: 100 }, frames, R), true);
});

test("just inside the radius hits, just outside misses", () => {
  assert.equal(isHit({ x: 130, y: 100 + R - 1 }, frames, R), true);
  assert.equal(isHit({ x: 130, y: 100 + R + 1 }, frames, R), false);
  assert.equal(isHit({ x: 100 - R - 1, y: 100 }, frames, R), false);
});

test("far away misses; identical positions do not divide by zero", () => {
  assert.equal(isHit({ x: 400, y: 400 }, frames, R), false);
  assert.equal(isHit({ x: 5, y: 5 }, [{ x: 5, y: 5 }, { x: 5, y: 5 }], R), true);
});
