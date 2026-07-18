import assert from "node:assert/strict";
import test from "node:test";

import { hideInitLoader } from "../../frontend/auth/authRuntimeState.js";

test("hiding a removed init loader still reveals the application content", () => {
  const previousDocument = globalThis.document;
  const removedClasses = [];
  globalThis.document = {
    getElementById() {
      return null;
    },
    body: {
      classList: {
        remove(value) {
          removedClasses.push(value);
        }
      }
    }
  };

  try {
    hideInitLoader();
    assert.deepEqual(removedClasses, ["bf-init-loading"]);
  } finally {
    globalThis.document = previousDocument;
  }
});
