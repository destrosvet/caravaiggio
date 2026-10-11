import { AI_POSTERIZATION_VERSION, type AiImportanceMask } from "../core/aiPosterization.ts";

const endpoint = "http://127.0.0.1:8766";

export function encodeRgba(pixels: Uint8ClampedArray): string {
  let binary = "";
  for (let i = 0; i < pixels.length; i += 32768) {
    binary += String.fromCharCode(...pixels.subarray(i, i + 32768));
  }
  return btoa(binary);
}

export async function analyzeWithSam3(pixels: Uint8ClampedArray, width: number, height: number, signal: AbortSignal): Promise<AiImportanceMask> {
  let response: Response;
  try {
    response = await fetch(endpoint + "/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ width, height, rgba: encodeRgba(pixels) }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw Error("Local SAM 3 is not running. Start the local AI service, then retry. Classical posterization is always available.");
  }
  let result;
  try { result = await response.json(); }
  catch { throw Error("Invalid response from the local SAM 3 service."); }
  if (!response.ok) throw Error(result?.error ?? "Local SAM 3 could not analyse the image.");
  if (!result || result.width !== width || result.height !== height || typeof result.importance !== "string" ||
      !Number.isInteger(result.subjects) || result.subjects < 0 || !Number.isInteger(result.details) || result.details < 0) {
    throw Error("Invalid SAM 3 response.");
  }
  if (result.analysisVersion !== AI_POSTERIZATION_VERSION) throw Error("Restart the local SAM 3 service to enable hair and accessory protection, then retry.");
  for (const key of ["humanDetails", "hairDetails", "accessoryDetails"]) {
    if (!Number.isInteger(result[key]) || result[key] < 0) throw Error("Invalid SAM 3 human detail counts.");
  }
  const binary = atob(result.importance);
  if (binary.length !== width * height) throw Error("Invalid SAM 3 mask dimensions.");
  if (typeof result.recognition !== "string" || typeof result.faceMask !== "string") throw Error("Restart the local SAM 3 service to enable facial details and shades, then retry.");
  const faceBinary = atob(result.faceMask);
  if (faceBinary.length !== width * height) throw Error("Invalid SAM 3 face mask dimensions.");
  const faceMask = Uint8Array.from(faceBinary, character => character.charCodeAt(0));
  let recognition: Uint8Array | undefined;
  if (result.recognition !== undefined) {
    if (typeof result.recognition !== "string" || !Number.isInteger(result.faces) || result.faces < 0 || !Number.isInteger(result.recognitionDetails) || result.recognitionDetails < 0) throw Error("Invalid SAM 3 recognition response.");
    const decoded = atob(result.recognition);
    if (decoded.length !== width * height) throw Error("Invalid SAM 3 recognition dimensions.");
    recognition = Uint8Array.from(decoded, character => character.charCodeAt(0));
  }
  return { width, height, faceMask, humanDetails: result.humanDetails, hairDetails: result.hairDetails, accessoryDetails: result.accessoryDetails, values: Uint8Array.from(binary, character => character.charCodeAt(0)), subjects: result.subjects, details: result.details,
    ...(recognition ? { recognition, faces: result.faces, recognitionDetails: result.recognitionDetails } : {}) };
}
