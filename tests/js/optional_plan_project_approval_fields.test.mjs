import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";


const markup = fs.readFileSync("views/modals/modal_kehoach.html", "utf8");
const workflow = fs.readFileSync("frontend/plans/KeHoachWorkflow.js", "utf8");

for (const fieldId of [
  "kh-soqdpheduyetduan",
  "kh-ngayqdpheduyetduan",
  "kh-coquanpheduyetduan",
]) {
  test(`${fieldId} is optional and has no required marker`, () => {
    const label = markup.match(
      new RegExp(`<label[^>]+for=["']${fieldId}["'][\\s\\S]*?<\\/label>`),
    )?.[0] || "";
    const input = markup.match(
      new RegExp(`<input[^>]+id=["']${fieldId}["'][^>]*>`),
    )?.[0] || "";

    assert.ok(label);
    assert.doesNotMatch(label, /class=["']required["']/);
    assert.ok(input);
    assert.doesNotMatch(input, /\srequired(?:\s|>|=)/);
  });
}

test("supplied project approval values remain in the project-plan save mapping", () => {
  for (const mapping of [
    'soQdPheDuyetDuAn: loaiHinhVal === "Dự án" ? soQdPheDuyetDuAn : ""',
    'ngayQdPheDuyetDuAn: loaiHinhVal === "Dự án" ? ngayQdPheDuyetDuAnYMD : ""',
    'coQuanPheDuyetDuAn: loaiHinhVal === "Dự án" ? coQuanPheDuyetDuAn : ""',
  ]) {
    assert.ok(workflow.includes(mapping), mapping);
  }
});
