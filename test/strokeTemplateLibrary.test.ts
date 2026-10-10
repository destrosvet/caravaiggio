import test from "node:test";
import assert from "node:assert/strict";
import { readUserTemplates } from "../src/project/strokeTemplateLibrary.ts";
import { strokeTemplates } from "../src/core/strokeTemplates.ts";
test("user library validates and preserves all recipe parameters", () => {
  const template = { ...strokeTemplates[0], id: "user-test", settings: { ...strokeTemplates[0].settings, strategyParameters: { bend: .8 } } };
  const library = readUserTemplates(JSON.stringify({ version: 1, templates: [template] }));
  assert.equal(library[0].settings.strategyParameters?.bend, .8);
  assert.equal(library[0].brush.shape, template.brush.shape);
  assert.deepEqual(readUserTemplates(null), []);
});
test("damaged, duplicate and unsupported saved templates are rejected", () => {
  const template = { ...strokeTemplates[0], id: "user-test" };
  assert.throws(() => readUserTemplates("broken"));
  assert.throws(() => readUserTemplates(JSON.stringify({ version: 2, templates: [] })));
  assert.throws(() => readUserTemplates(JSON.stringify({ version: 1, templates: [template, template] })));
  assert.throws(() => readUserTemplates(JSON.stringify({ version: 1, templates: [{ ...template, settings: { ...template.settings, strategyParameters: { imageInfluence: 2 } } }] })));
});
