import assert from "node:assert/strict";
import test from "node:test";

import { consumeAssistantStream } from "../../frontend/assistant/AssistantApi.js";


test("assistant hides an upstream HTML error page", async () => {
  const response = new Response(
    "<!DOCTYPE html><html><title>520: Web server is returning an unknown error</title></html>",
    { status: 520, headers: { "content-type": "text/html; charset=UTF-8" } },
  );

  await assert.rejects(
    () => consumeAssistantStream(response, () => {}),
    (error) => {
      assert.equal(error.status, 520);
      assert.doesNotMatch(error.message, /<!DOCTYPE|<html|Cloudflare/i);
      assert.ok(error.message.length < 240);
      return true;
    },
  );
});
