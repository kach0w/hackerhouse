/**
 * Pull a YouTube playlist for the lounge jam via Merge Agent Handler MCP.
 *
 * Uses the same registered-user / tool-pack path we verified by hand:
 * search → list_videos (for ISO 8601 durations) → JukeboxTrack[].
 *
 * Secrets stay in env — never commit API keys.
 */

import type { JukeboxTrack } from '@hackerhouse/shared';

const MERGE_API = 'https://ah-api.merge.dev/api/v1';

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}

/** True when the three Merge IDs needed for YouTube MCP are present. */
export function mergeJukeboxConfigured(): boolean {
  return !!(
    env('MERGE_API_KEY') &&
    env('MERGE_TOOL_PACK_ID') &&
    env('MERGE_REGISTERED_USER_ID')
  );
}

function parseIsoDuration(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  const total = h * 3600 + min * 60 + s;
  return total > 0 ? total : null;
}

interface McpSession {
  url: string;
  apiKey: string;
  sessionId: string;
}

async function mcpInit(packId: string, userId: string, apiKey: string): Promise<McpSession> {
  const url = `${MERGE_API}/tool-packs/${packId}/registered-users/${userId}/mcp`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'hackerhouse-jukebox', version: '1' },
      },
    }),
  });
  if (!res.ok) throw new Error(`Merge MCP initialize HTTP ${res.status}`);
  const sessionId = res.headers.get('mcp-session-id');
  if (!sessionId) throw new Error('Merge MCP missing Mcp-Session-Id');
  await res.arrayBuffer(); // drain

  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Mcp-Session-Id': sessionId,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });

  return { url, apiKey, sessionId };
}

function parseMcpBody(raw: string): unknown {
  const datas = raw
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data: '))
    .map((l) => l.slice(6));
  const text = datas.at(-1) ?? raw;
  return JSON.parse(text);
}

async function mcpCall(session: McpSession, name: string, args: unknown): Promise<unknown> {
  const res = await fetch(session.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.apiKey}`,
      'Mcp-Session-Id': session.sessionId,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  if (!res.ok) throw new Error(`Merge MCP ${name} HTTP ${res.status}`);
  const raw = await res.text();
  const envelope = parseMcpBody(raw) as {
    error?: unknown;
    result?: { isError?: boolean; content?: { text?: string }[] };
  };
  if (envelope.error) throw new Error(`Merge MCP ${name}: ${JSON.stringify(envelope.error)}`);
  const text = envelope.result?.content?.[0]?.text ?? '';
  if (envelope.result?.isError) throw new Error(`Merge MCP ${name} tool error: ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : null;
}

/**
 * Search YouTube through Merge and enrich with durations.
 * Returns [] on soft failure so the caller can keep the fallback playlist.
 */
export async function fetchMergePlaylist(): Promise<JukeboxTrack[]> {
  const apiKey = env('MERGE_API_KEY');
  const packId = env('MERGE_TOOL_PACK_ID');
  const userId = env('MERGE_REGISTERED_USER_ID');
  if (!apiKey || !packId || !userId) return [];

  const query = env('MERGE_JUKEBOX_QUERY') ?? '2010s pop official music video';
  const maxResults = Math.min(20, Math.max(3, Number(env('MERGE_JUKEBOX_COUNT') ?? 10) || 10));

  const session = await mcpInit(packId, userId, apiKey);

  const search = (await mcpCall(session, 'youtube__search', {
    input: {
      q: query,
      type: 'video',
      order: 'relevance',
      max_results: maxResults,
      page_token: null,
      published_after: null,
      published_before: null,
      region_code: null,
      relevance_language: null,
      channel_id: null,
      video_category_id: null,
      video_duration: null,
      video_definition: null,
      safe_search: null,
      part: 'snippet',
    },
  })) as {
    items?: {
      id?: { video_id?: string; videoId?: string };
      snippet?: { title?: string };
    }[];
  };

  const ids: string[] = [];
  const titles = new Map<string, string>();
  for (const item of search?.items ?? []) {
    const id = item.id?.video_id ?? item.id?.videoId;
    if (!id || ids.includes(id)) continue;
    ids.push(id);
    if (item.snippet?.title) titles.set(id, item.snippet.title);
  }
  if (ids.length === 0) return [];

  const details = (await mcpCall(session, 'youtube__list_videos', {
    input: {
      id: ids.join(','),
      part: 'snippet,contentDetails',
      chart: null,
      my_rating: null,
      max_results: ids.length,
      page_token: null,
      region_code: null,
      video_category_id: null,
    },
  })) as {
    items?: {
      id?: string;
      snippet?: { title?: string };
      content_details?: { duration?: string };
      contentDetails?: { duration?: string };
    }[];
  };

  const tracks: JukeboxTrack[] = [];
  for (const item of details?.items ?? []) {
    const id = item.id;
    if (!id) continue;
    const duration =
      parseIsoDuration(item.content_details?.duration) ??
      parseIsoDuration(item.contentDetails?.duration);
    if (!duration) continue;
    const title = item.snippet?.title ?? titles.get(id) ?? id;
    tracks.push({ videoId: id, title, durationSec: duration });
  }
  return tracks;
}
