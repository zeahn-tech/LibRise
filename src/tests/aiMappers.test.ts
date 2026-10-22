import { describe, it, expect } from 'vitest';
import { candidateToMatchInput, candidateToRecommendationInput, mergeParsedCvIntoProfile, skillNames } from '../services/ai/aiMappers';
import type { CandidateProfile } from '../types';
import type { ParsedCVResult } from '../services/ai/aiTypes';

const baseProfile = {
  userId: 'u1',
  fullName: 'Ada Kollie',
  county: 'Nimba',
  yearsOfExperience: 0,
  education: [],
  experience: [],
  skills: ['Welding', { name: 'Project Management' }],
  certifications: [],
  languages: [],
  portfolio: [],
  privacySettings: {} as any,
  updatedAt: ''
} as unknown as CandidateProfile;

const parsed: ParsedCVResult = {
  professionalSummary: 'Field engineer with solar experience.',
  extractedSkills: ['welding', 'Solar PV', 'Logistics'],
  experienceYears: 4.6,
  phone: '+231770000000',
  workHistory: [{ jobTitle: 'Technician', organization: 'SunPower', startDate: '2021-01', endDate: 'Present', responsibilities: ['Installed arrays'] }],
  education: [{ degree: 'BSc', institution: 'UL', graduationYear: '2020', fieldOfStudy: 'Electrical Engineering' }]
};

describe('AI input mappers', () => {
  it('flattens string and object skills', () => {
    expect(skillNames(baseProfile)).toEqual(['Welding', 'Project Management']);
  });

  it('maps a real profile to match and recommendation inputs', () => {
    const match = candidateToMatchInput(baseProfile, 'Ada');
    expect(match).toMatchObject({ id: 'u1', name: 'Ada', county: 'Nimba', skills: ['Welding', 'Project Management'] });
    expect(candidateToRecommendationInput(baseProfile)).toMatchObject({ id: 'u1', preferredCounties: ['Nimba'] });
  });

  it('CV merge only fills gaps and adds NEW skills (case-insensitive)', () => {
    const update = mergeParsedCvIntoProfile(baseProfile, parsed);
    expect(update.skills).toEqual([...baseProfile.skills, 'Solar PV', 'Logistics']);
    expect(update.bio).toBe('Field engineer with solar experience.');
    expect(update.yearsOfExperience).toBe(5);
    expect(update.experience?.[0]).toMatchObject({ jobTitle: 'Technician', company: 'SunPower', isCurrent: true });
    expect(update.education?.[0]).toMatchObject({ degree: 'BSc', fieldOfStudy: 'Electrical Engineering' });
  });

  it('CV merge never overwrites what the person already wrote', () => {
    const rich = {
      ...baseProfile,
      bio: 'My own bio',
      phone: '+231111',
      yearsOfExperience: 9,
      experience: [{ id: 'e1', startDate: '2019-01' }],
      education: [{ id: 'd1', degree: 'MSc', institution: 'X', fieldOfStudy: 'Y', startYear: 2018 }]
    } as unknown as CandidateProfile;
    const update = mergeParsedCvIntoProfile(rich, { ...parsed, extractedSkills: ['Welding'] });
    expect(update).toEqual({});
  });
});
