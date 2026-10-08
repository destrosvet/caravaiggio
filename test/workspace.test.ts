import assert from "node:assert/strict";
import test from "node:test";
import { defaultWorkspace, syncWorkspace, validateWorkspace } from "../src/core/workspace.ts";
import { createProject, parseProject, serializeProject } from "../src/project/model.ts";
test("workspace survives save and reopen including custom zones and positions", () => {
  const project = createProject();
  const workspace = { ...project.workspace, width: 800, zones: [...project.workspace.zones.map(zone => zone.type === "canvas" ? { ...zone, x: 100, y: 80 } : zone), { id: "obstacle", type: "forbidden" as const, name: "Clamp", x: 700, y: 400, width: 50, height: 40 }] };
  assert.deepEqual(parseProject(serializeProject({ ...project, workspace })).workspace, workspace);
});
test("v7 projects without workspace receive a valid default layout", () => {
  const { workspace, ...project } = createProject();
  const migrated = parseProject(JSON.stringify({ ...project, version: 7 }));
  assert.equal(migrated.version, 8);
  assert.deepEqual(validateWorkspace(migrated.workspace), []);
  assert.equal(migrated.workspace.zones.filter(zone => zone.type === "paint").length, 3);
});
test("workspace sync preserves existing positions, removes absent paints and updates canvas dimensions", () => {
  const project = createProject();
  const shifted = { ...project.workspace, zones: project.workspace.zones.map(zone => zone.type === "paint" ? { ...zone, x: 500 } : zone) };
  const result = syncWorkspace(shifted, { widthMm: 200, heightMm: 300 }, project.palette.slice(0, 2));
  assert.equal(result.zones.filter(zone => zone.type === "paint").length, 1);
  assert.equal(result.zones.find(zone => zone.type === "paint")?.x, 500);
  assert.equal(result.zones.find(zone => zone.type === "canvas")?.width, 200);
});
test("layout checks detect forbidden intersections and out-of-bounds zones", () => {
  const workspace = defaultWorkspace({ widthMm: 300, heightMm: 400 });
  const invalid = { ...workspace, zones: [...workspace.zones, { id: "clamp", type: "forbidden" as const, name: "Clamp", x: 60, y: 60, width: 10, height: 10 }, { id: "outside", type: "forbidden" as const, name: "Outside", x: 590, y: 590, width: 20, height: 20 }] };
  const issues = validateWorkspace(invalid);
  assert.ok(issues.some(issue => issue.includes("Canvas overlaps Clamp")));
  assert.ok(issues.some(issue => issue.includes("Outside is outside")));
});
test("invalid workspace data, duplicate ids and missing zones are rejected", () => {
  const project = createProject();
  for (const workspace of [{ ...project.workspace, width: -1 }, { ...project.workspace, zones: [] }, { ...project.workspace, zones: [...project.workspace.zones, project.workspace.zones[0]] }]) assert.throws(() => parseProject(JSON.stringify({ ...project, workspace })), /workspace|Workspace/);
});
