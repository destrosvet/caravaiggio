import assert from "node:assert/strict";
import test from "node:test";
import { applyLayoutProfile, captureLayout, createProjectWithDefaultLayout, loadLayoutProfiles, parseLayoutProfiles, saveLayoutProfiles } from "../src/project/workspaceProfiles.ts";
import { createProject, parseProject, serializeProject } from "../src/project/model.ts";
import { syncWorkspace } from "../src/core/workspace.ts";
test("machine profiles persist and default layout applies to new projects", t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "localStorage", previous); else Reflect.deleteProperty(globalThis, "localStorage"); });
  const project = createProject();
  const workspace = captureLayout({ ...project.workspace, width: 900, zones: project.workspace.zones.map(zone => zone.type === "paint" ? { ...zone, x: 700, width: 45, height: 50 } : zone) });
  const library = { version: 1 as const, defaultId: "machine", profiles: [{ id: "machine", name: "My machine", workspace }] };
  saveLayoutProfiles(library);
  assert.deepEqual(loadLayoutProfiles(), library);
  const next = createProjectWithDefaultLayout();
  assert.equal(next.workspace.width, 900);
  assert.equal(next.workspace.zones.find(zone => zone.type === "paint")?.width, 45);
  assert.equal(next.workspace.zones.find(zone => zone.type === "paint")?.x, 700);
  assert.equal(project.workspace.width, 600);
});
test("physical cups retain positions across new paint identities and additional paints", () => {
  const project = createProject();
  const profile = { id: "machine", name: "Machine", workspace: captureLayout({ ...project.workspace, zones: project.workspace.zones.map(zone => zone.type === "paint" ? { ...zone, width: 48, height: 48 } : zone) }) };
  const palette = project.palette.map(paint => ({ ...paint, id: `new-${paint.id}` }));
  const workspace = applyLayoutProfile(profile, { ...project, palette });
  assert.equal(workspace.zones.filter(zone => zone.type === "paint").length, 3);
  assert.ok(workspace.zones.filter(zone => zone.type === "paint").every(zone => zone.width === 48 && zone.paintId?.startsWith("new-")));
  const fewer = applyLayoutProfile(profile, { ...project, palette: palette.slice(0, 2) });
  const restored = syncWorkspace(fewer, project.canvas, palette);
  assert.equal(restored.zones.filter(zone => zone.type === "paint")[2].width, 48);
  const reopened = parseProject(serializeProject({ ...project, palette, workspace }));
  assert.deepEqual(reopened.workspace.paintSlots, workspace.paintSlots);
});
test("invalid machine profiles and dangling defaults are rejected", () => {
  assert.throws(() => parseLayoutProfiles(JSON.stringify({ version: 1, defaultId: "missing", profiles: [] })));
  assert.throws(() => parseLayoutProfiles(JSON.stringify({ version: 1, defaultId: null, profiles: [{ id: "x", name: "Machine" }] })));
});
