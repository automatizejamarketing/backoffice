import assert from "node:assert/strict";
import test from "node:test";

import { customerAudienceImportsEnabled, CUSTOMER_AUDIENCE_IMPORTS_ENABLED_ENV } from "./release";

test("customer audience imports default on and support a reversible operational disable", () => {
  assert.equal(customerAudienceImportsEnabled({}), true);
  assert.equal(customerAudienceImportsEnabled({ [CUSTOMER_AUDIENCE_IMPORTS_ENABLED_ENV]: "false" }), false);
  assert.equal(customerAudienceImportsEnabled({ [CUSTOMER_AUDIENCE_IMPORTS_ENABLED_ENV]: "true" }), true);
});
