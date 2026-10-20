import { z } from 'zod';

export const AiCaptionSchema = z.object({
  index: z.number().int().min(0).max(7),
  caption: z.string().min(1).max(240),
  alt: z.string().min(1).max(160),
});

export const AiReviewSchema = z.object({
  needed: z.boolean(),
  reasons: z.array(z.string().min(1).max(200)).max(8).default([]),
  severity: z.enum(['none', 'low', 'medium', 'high']).default('none'),
});

export const AiSafetySchema = z.object({
  spam_score: z.number().min(0).max(1),
  duplicate_confidence: z.number().min(0).max(1).default(0),
  misleading_risk: z.number().min(0).max(1).default(0),
  notes: z.string().max(600).default(''),
});

export const AiResultSchema = z.object({
  headline: z.string().min(8).max(180),
  dek: z.string().max(320).default(''),
  body: z.string().min(60).max(24_000),
  category: z.string().min(1).max(64),
  tags: z.array(z.string().min(1).max(32)).max(8).default([]),
  breaking: z.boolean().default(false),
  breaking_reason: z.string().max(300).default(''),
  image_captions: z.array(AiCaptionSchema).max(8).default([]),
  review: AiReviewSchema,
  safety: AiSafetySchema,
  summary: z.string().max(700).default(''),
});

export type AiResult = z.infer<typeof AiResultSchema>;
export type AiCaption = z.infer<typeof AiCaptionSchema>;

export const AiEditionSchema = z.object({
  headline: z.string().min(4).max(140),
  summary: z.string().min(20).max(1800),
  mood: z.string().min(2).max(40),
  lead_article_slug: z.string().max(120).default(''),
  rankings: z
    .array(
      z.object({
        slug: z.string().min(1).max(120),
        rank: z.number().min(0).max(100),
        placement: z.enum(['lead', 'top', 'standard']).default('standard'),
        editor_note: z.string().max(220).default(''),
      }),
    )
    .max(30)
    .default([]),
});

export type AiEdition = z.infer<typeof AiEditionSchema>;

export const AiAwardsSchema = z.object({
  awards: z
    .array(
      z.object({
        title: z.string().min(3).max(80),
        winner_name: z.string().min(1).max(80),
        citation: z.string().min(10).max(400),
        article_slug: z.string().max(120).default(''),
      }),
    )
    .min(1)
    .max(8),
});

export type AiAwards = z.infer<typeof AiAwardsSchema>;
