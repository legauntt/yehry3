import { test } from "node:test";
import assert from "node:assert/strict";
import { authorIdentity, authoredByMe } from "../assets/authored-by.js";

test("author matching folds Csaw into Scythe and strips duplicate listener numbers", () => {
  for (const name of ["Scythe", "scythe (2)", " Scythe (3) ", "Csaw", "CSAW (10)"]) {
    assert.equal(authorIdentity(name), "scythe");
    assert.equal(authoredByMe({ authoredBy: "Csaw" }, name), true);
  }
  assert.equal(authoredByMe({ authoredBy: "Pancakeo" }, "Pancakeo (3)"), true);
  for (const name of ["", undefined, "Scythecrow", "Pancakeo", "Scythe (1)", "Scythe (demo)"]) {
    assert.equal(authoredByMe({ authoredBy: "Scythe" }, name), false);
  }
  assert.equal(authoredByMe({}, ""), false);
});
