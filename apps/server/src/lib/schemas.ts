import { z } from 'zod';

import { isIsoDate } from '@ascend/core';

import { SECRET_NAMES } from '../secrets';

/** Request validation. Everything crossing the HTTP boundary is parsed here. */

/** Engine weights are configurable but bounded (spec §27). */
const weight = z.number().min(0).max(5);

const isoDate = z
  .string()
  .refine(isIsoDate, 'Must be a real calendar date in YYYY-MM-DD form');

/** Codeforces and AtCoder handle rules are permissive; the platform is the judge. */
const handle = z
  .string()
  .trim()
  .min(1, 'Handle cannot be empty')
  .max(64)
  .regex(/^[A-Za-z0-9_.-]+$/, 'Handles contain only letters, digits, dot, dash and underscore');

export const targetEventSchema = z.object({
  name: z.string().trim().min(1, 'Give the contest a name').max(200),
  date: isoDate,
  location: z.string().trim().max(200).nullish(),
  notes: z.string().max(4000).nullish(),
});

export const availabilitySchema = z.object({
  /** Minutes per weekday, index 0 = Sunday. */
  minutes: z.array(z.number().int().min(0).max(24 * 60)).length(7),
});

export const handlesSchema = z.object({
  codeforces: handle.nullish(),
  atcoder: handle.nullish(),
});

export const settingsPatchSchema = z.object({
  ai: z
    .object({
      enabled: z.boolean(),
      provider: z.enum(['anthropic', 'openai', 'ollama']),
      model: z.string().trim().min(1).max(200),
      deepModel: z.string().trim().min(1).max(200),
      baseUrl: z.string().trim().url().nullable(),
    })
    .partial()
    .optional(),
  sync: z
    .object({
      autoSyncOnLaunch: z.boolean(),
      intervalMinutes: z.number().int().min(5).max(24 * 60),
      fetchSubmissionSources: z.boolean(),
    })
    .partial()
    .optional(),
  training: z
    .object({
      preferredDays: z.array(z.number().int().min(0).max(6)).max(7),
      simulationsPerWeek: z.number().int().min(0).max(7),
      minDeepWorkMinutes: z.number().int().min(10).max(600),
    })
    .partial()
    .optional(),
  // Explicit shapes rather than z.record: a record keyed by an enum is
  // exhaustive in Zod 4, which would forbid patching a single weight.
  readinessWeights: z
    .object({
      algorithms: weight,
      implementation: weight,
      problem_recognition: weight,
      speed: weight,
      debugging: weight,
      contest_strategy: weight,
      mathematical_reasoning: weight,
      retention: weight,
    })
    .partial()
    .optional(),
  sourceWeights: z
    .object({
      codeforces: weight,
      codeforces_gym: weight,
      atcoder: weight,
    })
    .partial()
    .optional(),
});

export const secretNameSchema = z.enum(SECRET_NAMES);

export const secretValueSchema = z.object({
  value: z.string().min(1, 'Value cannot be empty').max(20_000),
});

export const profileSchema = z.object({
  displayName: z.string().trim().max(120).nullish(),
  teamName: z.string().trim().max(120).nullish(),
});

/** The whole onboarding flow in one submission (spec §8). */
export const onboardingSchema = z.object({
  profile: profileSchema.optional(),
  handles: handlesSchema,
  /**
   * Optional so the user can finish onboarding without a target date. The spec
   * forbids inventing one (§3), and the dashboard has a legitimate empty state.
   */
  targetEvent: targetEventSchema.nullish(),
  availability: availabilitySchema.shape.minutes.optional(),
  training: z
    .object({
      preferredDays: z.array(z.number().int().min(0).max(6)).max(7),
      simulationsPerWeek: z.number().int().min(0).max(7),
    })
    .partial()
    .optional(),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;
export type TargetEventInputDto = z.infer<typeof targetEventSchema>;
export type SettingsPatchDto = z.infer<typeof settingsPatchSchema>;
