import { isTauri } from "@tauri-apps/api/core";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { getCurrentWindow } from "@tauri-apps/api/window";

const filter = [{ name: "Projekt Caravaiggio", extensions: ["caravaiggio.json", "json"] }];

export const hasNativeProjectFiles = isTauri();

export function confirmDiscardChanges(): Promise<boolean> {
  if (!hasNativeProjectFiles) return Promise.resolve(window.confirm("Discard unsaved changes?"));
  return confirm("Your unsaved changes will be lost.", { title: "Discard changes?", kind: "warning", okLabel: "Discard", cancelLabel: "Keep editing" });
}

export function onNativeCloseRequested(handler: () => Promise<boolean>): Promise<() => void> {
  if (!hasNativeProjectFiles) return Promise.resolve(() => undefined);
  const appWindow = getCurrentWindow();
  return appWindow.onCloseRequested(async (event) => {
    event.preventDefault();
    if (await handler()) await appWindow.destroy();
  });
}

export async function openNativeProject(): Promise<{ contents: string; name: string } | null> {
  const path = await open({ multiple: false, directory: false, filters: filter });
  if (!path) return null;
  const contents = await readTextFile(path);
  return { contents, name: path.split(/[\\/]/).at(-1) ?? path };
}

export async function saveNativeProject(contents: string, suggestedName: string): Promise<string | null> {
  const path = await save({ defaultPath: suggestedName, filters: filter });
  if (!path) return null;
  await writeTextFile(path, contents);
  return path;
}

export async function saveNativeGcode(contents: string, suggestedName: string): Promise<string | null> {
  const path = await save({ defaultPath: suggestedName, filters: [{ name: "GRBL G-code", extensions: ["gcode", "nc"] }] });
  if (!path) return null;
  await writeTextFile(path, contents);
  return path;
}
