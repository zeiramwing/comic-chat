export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  OWNER_USERNAME?: string;
  SITE_NAME?: string;
  /** Per-user posting limits; defaults 12 per minute and 300 per day. */
  POST_LIMIT_PER_MIN?: string;
  POST_LIMIT_PER_DAY?: string;
}

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  pass_hash: string;
  pass_salt: string;
  pass_iter: number;
  role: 'member' | 'owner';
  character: string;
  profile: string;
  homepage: string;
  prefs: string;
  banned: number;
  ban_reason: string;
  created_at: number;
  last_seen_at: number;
}

export interface RoomRow {
  id: number;
  slug: string;
  name: string;
  topic: string;
  motd: string;
  default_backdrop: string;
  scene_changes: number;
  rev: number;
  created_at: number;
}

export interface EntryRow {
  id: number;
  room_id: number;
  user_id: number;
  author: string;
  character: string;
  emotion: number | null;
  intensity: number | null;
  kind: 'say' | 'think' | 'action' | 'whisper' | 'expression';
  text: string;
  fmt: string | null;
  backdrop: string | null;
  to_ids: string | null;
  created_at: number;
  deleted: number;
}

/** What the browser's layout engine consumes. */
export interface EntryDTO {
  id: number;
  userId: number;
  author: string;
  character: string;
  em: { e: number; i: number } | null;
  kind: EntryRow['kind'];
  text: string;
  fmt: unknown;
  backdrop: string | null;
  to: number[];
  ts: number;
}
