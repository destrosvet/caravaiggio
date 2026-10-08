import { parseWorkspace, syncWorkspace, type Workspace } from "../core/workspace.ts";
import { createProject, type CaravaiggioProject } from "./model.ts";
export type MachineLayoutProfile = Readonly<{ id: string; name: string; workspace: Workspace }>;
export type LayoutProfiles = Readonly<{ version: 1; defaultId: string | null; profiles: readonly MachineLayoutProfile[] }>;
const KEY = "caravaiggio.machine-layouts.v1";
export function parseLayoutProfiles(input: string): LayoutProfiles {
  const value = JSON.parse(input);
  if (value?.version !== 1 || !Array.isArray(value.profiles) || value.profiles.length > 100 || !(value.defaultId === null || typeof value.defaultId === "string")) throw new Error("Invalid machine profiles.");
  const ids = new Set<string>();
  const profiles = value.profiles.map((profile: MachineLayoutProfile) => {
    if (!profile || !profile.workspace || typeof profile.id !== "string" || !profile.id || ids.has(profile.id) || typeof profile.name !== "string" || !profile.name.trim()) throw new Error("Invalid machine profile.");
    ids.add(profile.id);
    return { id: profile.id, name: profile.name, workspace: parseWorkspace(profile.workspace, { widthMm: 300, heightMm: 400 }) };
  });
  if (value.defaultId !== null && !ids.has(value.defaultId)) throw new Error("Default machine profile is missing.");
  return { version: 1, defaultId: value.defaultId, profiles };
}
export function loadLayoutProfiles(): LayoutProfiles {
  const input = localStorage.getItem(KEY);
  return input ? parseLayoutProfiles(input) : { version: 1, defaultId: null, profiles: [] };
}
export function saveLayoutProfiles(profiles: LayoutProfiles): void {
  const validated = parseLayoutProfiles(JSON.stringify(profiles));
  localStorage.setItem(KEY, JSON.stringify(validated));
}
export function applyLayoutProfile(profile: MachineLayoutProfile, project: CaravaiggioProject): Workspace {
  const slots = profile.workspace.paintSlots ?? profile.workspace.zones.filter(zone => zone.type === "paint").map(({ x, y, width, height }) => ({ x, y, width, height }));
  return syncWorkspace({ ...profile.workspace, paintSlots: slots, zones: profile.workspace.zones.filter(zone => zone.type !== "paint") }, project.canvas, project.palette);
}
export function createProjectWithDefaultLayout(): CaravaiggioProject {
  const project = createProject();
  try {
    const profiles = loadLayoutProfiles();
    const profile = profiles.profiles.find(entry => entry.id === profiles.defaultId);
    return profile ? { ...project, workspace: applyLayoutProfile(profile, project) } : project;
  } catch { return project; }
}
export function captureLayout(workspace: Workspace): Workspace {
  const slots = workspace.zones.filter(zone => zone.type === "paint").map(({ x, y, width, height }) => ({ x, y, width, height }));
  return { ...workspace, paintSlots: [...slots, ...(workspace.paintSlots?.slice(slots.length) ?? [])] };
}
