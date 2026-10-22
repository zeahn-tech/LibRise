/**
 * Pure helpers for the /api/ai/* endpoints, kept out of server.ts so they can be unit tested without
 * booting Express, Vite and the Gemini SDK.
 */

/** Model is configurable so a Google model retirement never needs a code change (set GEMINI_MODEL). */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export function getGeminiModel(env: NodeJS.ProcessEnv = process.env): string {
  return (env.GEMINI_MODEL || '').trim() || DEFAULT_GEMINI_MODEL;
}

/** Human-readable provider label returned to the browser, e.g. "Gemini gemini-3.8-flash". */
export function providerLabel(model: string): string {
  return `Gemini ${model}`;
}

/** Thrown for malformed client input; the route maps it to HTTP 400. */
export class AiInputError extends Error {}

/** Thrown when the model answered but not with usable structured data; the route maps it to HTTP 502 so the
 *  browser falls back to the heuristic engine instead of rendering an empty result. */
export class AiOutputError extends Error {}

const MAX_TEXT = 20_000; // CVs / drafts
const MAX_ITEMS = 200; // opportunities in one request

function requireString(value: unknown, field: string, max = MAX_TEXT, allowEmpty = false): string {
  if (typeof value !== 'string') throw new AiInputError(`${field} must be text.`);
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) throw new AiInputError(`${field} is required.`);
  if (trimmed.length > max) throw new AiInputError(`${field} is too long (max ${max.toLocaleString()} characters).`);
  return trimmed;
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new AiInputError(`${field} is required.`);
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, field: string, max = MAX_ITEMS): unknown[] {
  if (!Array.isArray(value)) throw new AiInputError(`${field} must be a list.`);
  if (value.length > max) throw new AiInputError(`${field} has too many items (max ${max}).`);
  return value;
}

export function validateRecommendationsBody(body: any): { candidate: Record<string, any>; availableOpportunities: unknown[]; limit: number } {
  const candidate = requireObject(body?.candidate, 'candidate');
  const availableOpportunities = requireArray(body?.availableOpportunities, 'availableOpportunities');
  if (availableOpportunities.length === 0) throw new AiInputError('There are no opportunities to rank yet.');
  const limit = Math.min(Math.max(Number.isFinite(Number(body?.limit)) ? Math.floor(Number(body.limit)) : 5, 1), 20);
  return { candidate, availableOpportunities, limit };
}

export function validateMatchBody(body: any): { candidate: Record<string, any>; opportunity: Record<string, any> } {
  return { candidate: requireObject(body?.candidate, 'candidate'), opportunity: requireObject(body?.opportunity, 'opportunity') };
}

export function validateCvBody(body: any): { cvText: string } {
  const cvText = requireString(body?.cvText, 'cvText');
  if (cvText.length < 40) throw new AiInputError('Paste more of the CV text so there is enough to analyse.');
  return { cvText };
}

export function validateJobAssistantBody(body: any): { title: string; county: string; opportunityType: string; rawNotesOrDraft: string } {
  return {
    title: requireString(body?.title, 'title', 200),
    county: typeof body?.county === 'string' && body.county.trim() ? body.county.trim().slice(0, 60) : 'Montserrado',
    opportunityType: typeof body?.opportunityType === 'string' && body.opportunityType.trim() ? body.opportunityType.trim().slice(0, 40) : 'Job',
    rawNotesOrDraft: requireString(body?.rawNotesOrDraft ?? '', 'rawNotesOrDraft', MAX_TEXT, true)
  };
}

export function validateSemanticSearchBody(body: any): { query: string; opportunities: unknown[] } {
  const query = requireString(body?.query, 'query', 500);
  const opportunities = requireArray(body?.opportunities, 'opportunities');
  return { query, opportunities };
}

export function validateScamCheckBody(body: any): { text: string } {
  const text = requireString(body?.text, 'text');
  if (text.length < 20) throw new AiInputError('Paste the full vacancy or listing text to scan.');
  return { text };
}

/** Parses the model's JSON output and fails loudly (instead of returning `{}`) when it is empty or malformed. */
export function parseModelJson<T = Record<string, any>>(text: string | undefined | null, requiredKeys: string[] = []): T {
  if (!text || !text.trim()) throw new AiOutputError('The AI model returned an empty response.');
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiOutputError('The AI model returned malformed JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new AiOutputError('The AI model returned an unexpected shape.');
  for (const key of requiredKeys) {
    if (parsed[key] === undefined || parsed[key] === null) throw new AiOutputError(`The AI model response is missing "${key}".`);
  }
  return parsed as T;
}
