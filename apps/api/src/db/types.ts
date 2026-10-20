export type SubmissionStatus =
  'received' | 'processing' | 'queued_review' | 'published' | 'rejected' | 'failed';

export interface SubmissionRow {
  id: string;
  public_token: string;
  headline: string;
  story: string;
  author_name: string;
  discord_handle: string | null;
  contact_email: string | null;
  category_slug: string | null;
  source_url: string | null;
  anonymous: number;
  identity_mode: 'named' | 'discord' | 'anonymous';
  status: SubmissionStatus;
  review_reason: string | null;
  review_reasons: string | null;
  spam_score: number;
  misleading_risk: number;
  duplicate_of: string | null;
  duplicate_score: number;
  content_hash: string;
  simhash: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  ai_model: string | null;
  ai_attempts: number;
  ai_last_error: string | null;
  ai_result: string | null;
  article_id: string | null;
  member_id: string | null;
  processed_at: string | null;
  editor_override_at: string | null;
  editor_override_by: string | null;
  editor_override_note: string | null;
  editor_override_reasons: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubmissionImageRow {
  id: string;
  submission_id: string;
  upload_id: string | null;
  storage_key: string;
  thumb_key: string | null;
  url: string;
  thumb_url: string | null;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  checksum: string | null;
  caption: string | null;
  alt_text: string | null;
  attribution: string | null;
  position: number;
  created_at: string;
  original_key: string | null;
  original_url: string | null;
  original_bytes: number | null;
  original_mime: string | null;
  original_store: string | null;
  original_preserved: number;
  original_pruned_at: string | null;
}

export interface UploadRow {
  id: string;
  token_hash: string;
  status: 'pending' | 'stored' | 'claimed' | 'expired';
  storage_key: string | null;
  thumb_key: string | null;
  url: string | null;
  thumb_url: string | null;
  mime: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  checksum: string | null;
  original_name: string | null;
  ip_hash: string | null;
  submission_id: string | null;
  expires_at: string;
  created_at: string;
  stored_at: string | null;
  claimed_at: string | null;
  original_key: string | null;
  original_url: string | null;
  original_bytes: number | null;
  original_mime: string | null;
  original_store: string | null;
  original_preserved: number;
  original_pruned_at: string | null;
}

export interface ArticleRow {
  id: string;
  slug: string;
  submission_id: string | null;
  headline: string;
  dek: string | null;
  body: string;
  original_body: string | null;
  category_slug: string;
  author_display: string;
  author_member_id: string | null;
  identity_mode: 'named' | 'discord' | 'anonymous';
  tags: string;
  breaking: number;
  featured: number;
  placement: 'lead' | 'top' | 'standard';
  rank_score: number;
  editor_note: string | null;
  status: 'draft' | 'published' | 'unpublished' | 'deleted';
  source_url: string | null;
  ai_model: string | null;
  ai_generated: number;
  reading_minutes: number;
  edition_date: string;
  views: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArticleImageRow {
  id: string;
  article_id: string;
  upload_id: string | null;
  storage_key: string;
  thumb_key: string | null;
  url: string;
  thumb_url: string | null;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  checksum: string | null;
  caption: string | null;
  alt_text: string | null;
  attribution: string | null;
  position: number;
  created_at: string;
  original_key: string | null;
  original_url: string | null;
  original_bytes: number | null;
  original_mime: string | null;
  original_store: string | null;
  original_preserved: number;
  original_pruned_at: string | null;
}

export interface CategoryRow {
  slug: string;
  name: string;
  description: string | null;
  accent: string | null;
  sort_order: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface EditionRow {
  edition_date: string;
  headline: string | null;
  summary: string | null;
  mood: string | null;
  lead_article_id: string | null;
  article_count: number;
  generated_by: string;
  ai_model: string | null;
  status: 'draft' | 'published';
  created_at: string;
  updated_at: string;
}

export interface AwardRow {
  id: string;
  title: string;
  category: string | null;
  winner_name: string;
  winner_member_id: string | null;
  citation: string | null;
  edition_date: string | null;
  article_id: string | null;
  auto_generated: number;
  active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface MemberRow {
  id: string;
  display_name: string;
  discord_username: string | null;
  discord_id: string | null;
  global_name: string | null;
  avatar_url: string | null;
  submission_count: number;
  published_count: number;
  created_at: string;
  updated_at: string;
}

export interface UserSessionRow {
  id: string;
  member_id: string;
  token_hash: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  ip_hash: string | null;
  user_agent: string | null;
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  password_hash: string;
  role: 'owner' | 'editor';
  disabled: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminSessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  ip_hash: string | null;
  user_agent: string | null;
  revoked: number;
  created_at: string;
}

export interface ReportRow {
  id: string;
  article_id: string | null;
  reason: string;
  detail: string | null;
  reporter_contact: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  resolution_note: string | null;
  ip_hash: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface CorrectionRow {
  id: string;
  article_id: string;
  summary: string;
  detail: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  submitted_by: string | null;
  ip_hash: string | null;
  admin_id: string | null;
  created_at: string;
  applied_at: string | null;
}
