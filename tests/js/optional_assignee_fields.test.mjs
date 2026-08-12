import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";


for (const [file, selectId] of [
  ["views/modals/modal_goithau.html", "gt-nhanvienphutrach"],
  ["views/modals/modal_hopdong.html", "hd-nhanvienphutrach"],
]) {
  test(`${selectId} is optional and has no required marker`, () => {
    const markup = fs.readFileSync(file, "utf8");
    const label = markup.match(new RegExp(`<label[^>]+for=["']${selectId}["'][\\s\\S]*?<\\/label>`))?.[0] || "";
    const select = markup.match(new RegExp(`<select[^>]+id=["']${selectId}["'][^>]*>`))?.[0] || "";

    assert.ok(label);
    assert.doesNotMatch(label, /class=["']required["']/);
    assert.ok(select);
    assert.doesNotMatch(select, /\srequired(?:\s|>|=)/);
  });
}
