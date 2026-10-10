import assert from "node:assert/strict";
import test from "node:test";
import {
  createProject,
  parseProject,
  serializeProject,
} from "../src/project/model.ts";

test("a project preserves its image and dimensions after serialization and reopening", () => {
  const project = createProject("Test painting");
  const saved = {
    ...project,
    canvas: {
      widthMm: 500,
      heightMm: 300,
      orientation: "landscape" as const,
      units: "mm" as const,
    },
    sourceImage: {
      name: "predloha.png",
      mimeType: "image/png" as const,
      widthPx: 2,
      heightPx: 1,
      dataUrl: "data:image/png;base64,AA==",
    },
  };
  const reopened = parseProject(serializeProject(saved));
  assert.equal(reopened.name, project.name);
  assert.deepEqual(reopened.canvas, saved.canvas);
  assert.deepEqual(reopened.sourceImage, saved.sourceImage);
  assert.equal(reopened.version, 14);
});

test("a v1 project is migrated to the current version when opened", () => {
  const current = createProject("Legacy project");
  const legacy = {
    ...current,
    version: 1,
    canvas: { widthMm: 210, heightMm: 297, orientation: "portrait" },
  };
  const migrated = parseProject(JSON.stringify(legacy));
  assert.equal(migrated.version, 14);
  assert.equal(migrated.canvas.units, "mm");
  assert.equal(migrated.palette.length, 4);
});

test("a v6 uniform source transform is migrated to independent axes", () => {
  const project = createProject();
  const legacy = {
    ...project,
    version: 6,
    sourceTransform: {
      offsetXPercent: 4,
      offsetYPercent: -3,
      scale: 1.5,
      rotationDeg: 12,
    },
  };
  const migrated = parseProject(JSON.stringify(legacy));
  assert.equal(migrated.sourceTransform.scaleX, 1.5);
  assert.equal(migrated.sourceTransform.scaleY, 1.5);
});

test("a palette larger than eight survives project save and reopen", () => {
  const project = createProject();
  const palette = Array.from({ length: 16 }, (_, index) => ({
    ...project.palette[1],
    id: `color-${index}`,
    name: `Color ${index}`,
    hex: "#112233" as const,
    locked: false,
  }));
  const reopened = parseProject(serializeProject({ ...project, palette }));
  assert.deepEqual(reopened.palette, palette);
  assert.equal(reopened.workspace.zones.filter(zone => zone.type === "paint").length, 16);
  const paintSlots = reopened.workspace.zones.filter(zone => zone.type === "paint").map(({ x, y, width, height }) => ({ x, y, width, height }));
  const savedSlots = parseProject(serializeProject({ ...reopened, workspace: { ...reopened.workspace, paintSlots } }));
  assert.deepEqual(savedSlots.workspace.paintSlots, paintSlots);
});

test("palettes reserve pixel map index 255 for the mask", () => {
  const project = createProject();
  const palette = Array.from({ length: 255 }, (_, index) => ({ ...project.palette[1], id: `paint-${index}` }));
  assert.equal(parseProject(serializeProject({ ...project, palette })).palette.length, 255);
  assert.throws(() => parseProject(JSON.stringify({ ...project, palette: [...palette, { ...project.palette[1], id: "overflow" }] })), /between 1 and 255/);
});

test("corrupted image data is rejected", () => {
  const project = {
    ...createProject(),
    sourceImage: {
      name: "x.png",
      mimeType: "image/png",
      widthPx: 1,
      heightPx: 1,
      dataUrl: "neplatna-data",
    },
  };
  assert.throws(
    () => parseProject(JSON.stringify(project)),
    /corrupted source image data/,
  );
});

test("an unknown project version is rejected", () => {
  assert.throws(
    () => parseProject('{"format":"caravaiggio-project","version":99}'),
    /Unsupported/,
  );
});

test("the default white palette entry represents unpainted canvas", () => {
  const project = createProject();
  assert.equal(project.palette[0].id, "titanium-white");
  assert.equal(project.palette[0].skipPainting, true);
  assert.equal(
    project.palette.slice(1).some((color) => color.skipPainting),
    false,
  );
});
