import type { StrokeTemplate } from "../core/strokeTemplates.ts";
import { validateBrush, validateStrokeSettings } from "./model.ts";
export const strokeTemplateStorageKey = "caravaiggio.stroke-templates.v1";
export function readUserTemplates(value: string | null): StrokeTemplate[] {
  if (!value) return [];
  const data = JSON.parse(value);
  if (!data || data.version !== 1 || !Array.isArray(data.templates) || data.templates.length > 200) throw new Error("Invalid template library.");
  const ids = new Set<string>();
  return data.templates.map((item: StrokeTemplate) => {
    if (!item || typeof item.id !== "string" || !item.id.startsWith("user-") || ids.has(item.id) || typeof item.name !== "string" || !item.name.trim() || typeof item.description !== "string") throw new Error("Invalid saved template.");
    ids.add(item.id);
    return { ...item, brush: validateBrush(item.brush), settings: validateStrokeSettings(item.settings) };
  });
}
