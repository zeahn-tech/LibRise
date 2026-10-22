/**
 * Gemini Server-Backed AI Provider
 * LibRise
 * 
 * Communicates with server-side Express endpoints powered by @google/genai (gemini-3.8-flash).
 */

import {
  IAIProvider,
  JobRecommendationInput,
  JobRecommendationsResponse,
  CandidateMatchInput,
  CandidateMatchResult,
  CVParsingInput,
  ParsedCVResult,
  JobAssistantInput,
  JobAssistantResult,
  SemanticSearchInput,
  SemanticSearchResponse,
  ScamCheckInput,
  ScamCheckResult
} from './aiTypes';
import { authService } from '../authService';
import { envConfig } from '../../config/env';

// Same-origin '/api' by default (Express serves the app); set VITE_API_BASE_URL to the
// deployed backend's /api URL when the frontend is hosted separately (e.g. GitHub Pages).
const API = envConfig.apiBaseUrl.replace(/\/+$/, '');

const HEALTH_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 45_000;

export class GeminiAIProvider implements IAIProvider {
  name = 'Gemini (Server Intelligence)';
  private healthCache: { at: number; configured: boolean } | null = null;

  /** Health is cached briefly so each AI action does not pay an extra round trip. */
  async isAvailable(): Promise<boolean> {
    if (this.healthCache && Date.now() - this.healthCache.at < HEALTH_TTL_MS) return this.healthCache.configured;
    let configured = false;
    try {
      const res = await fetch(`${API}/ai/health`, { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        configured = !!data.configured;
        if (configured && data.model) this.name = `Gemini ${data.model}`;
      }
    } catch {
      configured = false;
    }
    this.healthCache = { at: Date.now(), configured };
    return configured;
  }

  /** Authenticated POST. Throws with the server's message so the facade can fall back and logs stay meaningful. */
  private async post<T>(path: string, input: unknown, label: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${API}/ai/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authService.getSession()?.token || ''}`
        },
        body: JSON.stringify(input),
        signal: controller.signal
      });
      if (!res.ok) {
        // A failed request may mean the server just lost its key or went down: re-check health next time.
        this.healthCache = null;
        let detail = '';
        try {
          detail = (await res.json())?.error || '';
        } catch {
          /* non-JSON error body */
        }
        throw new Error(`${label} failed (${res.status})${detail ? `: ${detail}` : ''}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  getJobRecommendations(input: JobRecommendationInput): Promise<JobRecommendationsResponse> {
    return this.post('recommendations', input, 'Gemini Recommendations');
  }

  matchCandidateToJob(input: CandidateMatchInput): Promise<CandidateMatchResult> {
    return this.post('match-candidate', input, 'Gemini Candidate Match');
  }

  parseCV(input: CVParsingInput): Promise<ParsedCVResult> {
    return this.post('parse-cv', input, 'Gemini CV Parsing');
  }

  assistJobDescription(input: JobAssistantInput): Promise<JobAssistantResult> {
    return this.post('job-assistant', input, 'Gemini Job Assistant');
  }

  semanticSearch(input: SemanticSearchInput): Promise<SemanticSearchResponse> {
    return this.post('semantic-search', input, 'Gemini Semantic Search');
  }

  scanForScams(input: ScamCheckInput): Promise<ScamCheckResult> {
    return this.post('scam-check', input, 'Gemini Scam Check');
  }
}
