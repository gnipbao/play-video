"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

test("展示场景与 record.html 的 id/duration 元数据一致", () => {
  const scenesRoot = path.join(ROOT, "web/scenes");
  for (const entry of fs.readdirSync(scenesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const scenePath = path.join(scenesRoot, entry.name, "scene.js");
    if (!fs.existsSync(scenePath)) continue;
    const recordPath = entry.name === "control"
      ? path.join(ROOT, "web/record.html")
      : path.join(scenesRoot, entry.name, "record.html");
    assert.ok(fs.existsSync(recordPath), `${entry.name} 缺少 record.html`);
    const scene = fs.readFileSync(scenePath, "utf8");
    const record = fs.readFileSync(recordPath, "utf8");
    const id = scene.match(/\bid:\s*"([^"]+)"/);
    const duration = scene.match(/\bduration:\s*([0-9.]+)/);
    const recordId = record.match(/data-composition-id="([^"]+)"/);
    const recordDuration = record.match(/data-duration="([0-9.]+)"/);
    assert.equal(recordId && recordId[1], id && id[1], `${entry.name} id 不一致`);
    assert.equal(
      Number(recordDuration && recordDuration[1]),
      Number(duration && duration[1]),
      `${entry.name} duration 不一致`,
    );
  }
});
