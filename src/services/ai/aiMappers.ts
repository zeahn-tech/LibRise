/**
 * Maps real LibRise records (candidate profiles, opportunities) onto the AI service input contracts, so every
 * AI feature runs on the signed-in person's actual data rather than hardcoded samples.
 */
import type { CandidateProfile, ExperienceItem, Opportunity } from '../../types';
import type { CandidateMatchInput, JobRecommendationInput, ParsedCVResult } from './aiTypes';

export function skillNames(profile: Pick<CandidateProfile, 'skills'>): string[] {
  return (profile.skills || [])
    .map((s) => (typeof s === 'string' ? s : s?.name))
    .filter((s): s is string => !!s && s.trim().length > 0);
}

function durationOf(e: ExperienceItem): string {
  const start = e.startDate || '';
  const end = e.isCurrent || e.current ? 'Present' : e.endDate || '';
  return [start, end].filter(Boolean).join(' - ');
}

function describe(e: ExperienceItem): string {
  const parts = [...(e.responsibilities || []), ...(e.accomplishments || [])];
  return (e.description || parts.join('; ')).trim();
}

export function candidateToMatchInput(profile: CandidateProfile, displayName?: string): CandidateMatchInput['candidate'] {
  return {
    id: profile.userId,
    name: displayName || profile.fullName,
    skills: skillNames(profile),
    county: String(profile.county || ''),
    experienceYears: profile.yearsOfExperience || 0,
    summary: [profile.headline, profile.bio].filter(Boolean).join('. ') || undefined,
    workHistory: (profile.experience || []).map((e) => ({
      title: e.jobTitle || e.title || '',
      company: e.company || e.companyName || '',
      duration: durationOf(e),
      description: describe(e)
    })),
    education: (profile.education || []).map((e) => ({
      degree: [e.degree, e.fieldOfStudy].filter(Boolean).join(' in '),
      institution: e.institution,
      year: String(e.endYear ?? e.startYear ?? '')
    }))
  };
}

export function candidateToRecommendationInput(profile: CandidateProfile): JobRecommendationInput['candidate'] {
  return {
    id: profile.userId,
    skills: skillNames(profile),
    preferredCounties: profile.county ? [String(profile.county)] : [],
    experienceYears: profile.yearsOfExperience || 0,
    desiredRole: profile.headline || undefined,
    educationLevel: profile.highestEducationLevel || undefined
  };
}

export function opportunityToMatchInput(o: Opportunity): CandidateMatchInput['opportunity'] {
  return {
    id: o.id,
    title: o.title,
    organizationName: o.organization?.name || 'Organization',
    county: String(o.county),
    opportunityType: o.type,
    skillsRequired: o.skills || [],
    description: o.description,
    requirements: o.requirements || []
  };
}

/**
 * Builds the profile update for "Save to my profile" after a CV is parsed. Deliberately conservative: it only
 * fills gaps and adds new skills. It never overwrites text, work history or education the person already wrote.
 */
export function mergeParsedCvIntoProfile(profile: CandidateProfile, parsed: ParsedCVResult): Partial<CandidateProfile> {
  const update: Partial<CandidateProfile> = {};

  const existing = skillNames(profile);
  const known = new Set(existing.map((s) => s.toLowerCase()));
  const added = (parsed.extractedSkills || []).map((s) => s.trim()).filter((s) => s && !known.has(s.toLowerCase()));
  if (added.length > 0) update.skills = [...(profile.skills || []), ...added];

  if (!profile.bio?.trim() && parsed.professionalSummary?.trim()) update.bio = parsed.professionalSummary.trim();
  if (!profile.phone?.trim() && parsed.phone?.trim()) update.phone = parsed.phone.trim();
  if (!profile.cityDistrict?.trim() && parsed.cityDistrict?.trim()) update.cityDistrict = parsed.cityDistrict.trim();
  if (!(profile.yearsOfExperience > 0) && parsed.experienceYears > 0) update.yearsOfExperience = Math.round(parsed.experienceYears);

  const stamp = Date.now();
  if ((profile.experience || []).length === 0 && (parsed.workHistory || []).length > 0) {
    update.experience = parsed.workHistory.map((w, i) => ({
      id: `cv-exp-${stamp}-${i}`,
      jobTitle: w.jobTitle,
      company: w.organization,
      startDate: w.startDate || '',
      endDate: w.endDate && !/present|current/i.test(w.endDate) ? w.endDate : undefined,
      isCurrent: !!w.endDate && /present|current/i.test(w.endDate),
      responsibilities: w.responsibilities || []
    }));
  }
  if ((profile.education || []).length === 0 && (parsed.education || []).length > 0) {
    update.education = parsed.education.map((e, i) => ({
      id: `cv-edu-${stamp}-${i}`,
      degree: e.degree,
      institution: e.institution,
      fieldOfStudy: e.fieldOfStudy || '',
      startYear: '',
      endYear: e.graduationYear || undefined
    }));
  }
  return update;
}
