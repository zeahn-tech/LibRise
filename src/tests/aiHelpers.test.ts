import { describe, it, expect } from 'vitest';
import {
  AiInputError,
  AiOutputError,
  DEFAULT_GEMINI_MODEL,
  getGeminiModel,
  parseModelJson,
  validateCvBody,
  validateJobAssistantBody,
  validateMatchBody,
  validateRecommendationsBody,
  validateScamCheckBody,
  validateSemanticSearchBody
} from '../../server/aiHelpers';

describe('AI server helpers', () => {
  it('model is configurable and has a default', () => {
    expect(getGeminiModel({} as NodeJS.ProcessEnv)).toBe(DEFAULT_GEMINI_MODEL);
    expect(getGeminiModel({ GEMINI_MODEL: ' gemini-3.5-flash ' } as NodeJS.ProcessEnv)).toBe('gemini-3.5-flash');
  });

  it('parseModelJson fails loudly on empty or malformed output instead of returning {}', () => {
    expect(() => parseModelJson('')).toThrow(AiOutputError);
    expect(() => parseModelJson(undefined)).toThrow(AiOutputError);
    expect(() => parseModelJson('not json')).toThrow(AiOutputError);
    expect(() => parseModelJson('{"a":1}', ['b'])).toThrow(/missing "b"/);
    expect(parseModelJson<{ a: number }>('{"a":1}', ['a']).a).toBe(1);
  });

  it('rejects malformed request bodies with AiInputError', () => {
    expect(() => validateCvBody({})).toThrow(AiInputError);
    expect(() => validateCvBody({ cvText: 'too short' })).toThrow(/more of the CV/);
    expect(() => validateCvBody({ cvText: 'x'.repeat(20_001) })).toThrow(/too long/);
    expect(() => validateMatchBody({ candidate: {} })).toThrow(AiInputError);
    expect(() => validateRecommendationsBody({ candidate: {}, availableOpportunities: [] })).toThrow(/no opportunities/i);
    expect(() => validateRecommendationsBody({ candidate: {}, availableOpportunities: new Array(201).fill({}) })).toThrow(/too many/);
    expect(() => validateSemanticSearchBody({ query: '', opportunities: [] })).toThrow(AiInputError);
    expect(() => validateScamCheckBody({ text: 'short' })).toThrow(AiInputError);
    expect(() => validateJobAssistantBody({ title: '   ' })).toThrow(AiInputError);
  });

  it('accepts valid bodies and applies safe defaults and bounds', () => {
    expect(validateRecommendationsBody({ candidate: { id: 'c' }, availableOpportunities: [{ id: 'o' }], limit: 999 }).limit).toBe(20);
    expect(validateRecommendationsBody({ candidate: { id: 'c' }, availableOpportunities: [{ id: 'o' }] }).limit).toBe(5);
    expect(validateJobAssistantBody({ title: 'Driver' })).toMatchObject({ county: 'Montserrado', opportunityType: 'Job', rawNotesOrDraft: '' });
    expect(validateScamCheckBody({ text: 'Pay a registration fee to apply for this job today.' }).text).toContain('registration fee');
  });
});
