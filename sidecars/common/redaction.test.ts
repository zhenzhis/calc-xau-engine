import assert from "node:assert/strict";
import test from "node:test";

import { redactSecrets } from "./redaction.js";

test("redactSecrets masks sensitive object keys and JSON-like strings", () => {
  assert.deepEqual(redactSecrets({ accessToken: "abc", nested: { password: "def", ok: "visible" } }), {
    accessToken: "[REDACTED]",
    nested: { password: "[REDACTED]", ok: "visible" },
  });
  assert.equal(redactSecrets('{"mdAccessToken":"abc","price":10}'), '{"mdAccessToken":[REDACTED],"price":10}');
});
