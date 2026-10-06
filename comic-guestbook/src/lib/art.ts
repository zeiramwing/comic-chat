import type { Env } from '../types.ts';

interface ArtIndex {
  characters: Set<string>;
  backdrops: Set<string>;
}

let cached: { at: number; index: ArtIndex } | null = null;

/** Which character and backdrop ids exist, read from the deployed static art. */
export async function artIndex(env: Env, origin: string): Promise<ArtIndex> {
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.index;
  const res = await env.ASSETS.fetch(new Request(new URL('/art/index.json', origin)));
  if (!res.ok) throw new Error('art index unavailable');
  const data = (await res.json()) as { characters: { id: string }[]; backdrops: { id: string }[] };
  const index = {
    characters: new Set(data.characters.map((c) => c.id)),
    backdrops: new Set(data.backdrops.map((b) => b.id)),
  };
  cached = { at: Date.now(), index };
  return index;
}
