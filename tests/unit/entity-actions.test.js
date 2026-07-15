import test from "node:test";
import assert from "node:assert/strict";
import { renderEntityActions, standardEditDeleteActions } from "../../frontend/shared/EntityActions.js";

test("entity actions render one shared edit/delete command group", () => {
  const html = renderEntityActions(standardEditDeleteActions({
    id: 'id"1', editCommand: "edit-record", deleteCommand: "delete-record"
  }));
  assert.match(html, /action-btn-group/);
  assert.match(html, /data-bf-action="edit-record"/);
  assert.match(html, /data-bf-action="delete-record"/);
  assert.match(html, /data-id="id&quot;1"/);
});
