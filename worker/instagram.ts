import type { InstagramFeed, InstagramPost } from '../shared/instagram.ts'

export type InstagramEnv = { INSTAGRAM_ACCESS_TOKEN?: string }
type FeedCache = Pick<Cache, 'match' | 'put'>
const POST_LIMIT = 6
const FRESH_SECONDS = 15 * 60
const FAILURE_SECONDS = 60

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function safeUrl(value: unknown, permalink = false): string | null {
  if (typeof value !== 'string' || value.length > 8192) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    if ([...url.searchParams.keys()].some((key) => key.toLowerCase() === 'access_token')) return null
    if (permalink) {
      if (!['www.instagram.com', 'instagram.com'].includes(url.hostname) || !/^\/(p|reel|tv)\/[\w-]+\/?$/.test(url.pathname)) return null
      // Only the post destination is needed, not tracking parameters.
      url.search = ''
    } else if (!['cdninstagram.com', 'fbcdn.net'].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null
    if (!permalink && /\.(mp4|mov|webm|m3u8)$/i.test(url.pathname)) return null
    url.hash = ''
    return url.href
  } catch { return null }
}

export function normalizeInstagram(value: unknown): InstagramFeed {
  const response = object(value)
  if (!response || response.error || !Array.isArray(response.data)) throw new Error('Instagram unavailable')
  const posts = new Map<string, InstagramPost>()
  for (const entry of response.data) {
    const post = object(entry)
    if (!post || typeof post.id !== 'string' || !/^[\w-]{1,128}$/.test(post.id)) continue
    const mediaType = post.media_type
    if (mediaType !== 'IMAGE' && mediaType !== 'VIDEO' && mediaType !== 'CAROUSEL_ALBUM') continue
    const permalink = safeUrl(post.permalink, true)
    if (!permalink || posts.has(post.id)) continue
    const parsedTime = typeof post.timestamp === 'string' ? Date.parse(post.timestamp) : NaN
    posts.set(post.id, {
      id: post.id,
      caption: typeof post.caption === 'string' ? post.caption.trim().slice(0, 500) || null : null,
      mediaType,
      // Never return/load the MP4 as a preview, even when a video thumbnail is missing.
      displayUrl: safeUrl(mediaType === 'VIDEO' ? post.thumbnail_url : post.media_url),
      permalink,
      timestamp: Number.isFinite(parsedTime) ? new Date(parsedTime).toISOString() : null,
    })
  }
  return { posts: [...posts.values()].sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? '')).slice(0, POST_LIMIT) }
}

export async function instagramResponse(request: Request, env: InstagramEnv, cache?: FeedCache, fetcher: typeof fetch = fetch): Promise<Response> {
  const token = env.INSTAGRAM_ACCESS_TOKEN?.trim()
  if (!token) return Response.json({ error: 'Instagram is temporarily unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  // Strip visitor query strings and headers so they cannot fragment or personalize this public cache.
  const key = new Request(new URL('/api/instagram', request.url), { method: 'GET' })
  try {
    const cached = await cache?.match(key)
    if (cached) return cached
  } catch { /* Cache availability must not determine feed availability. */ }

  let response: Response
  try {
    const url = new URL('https://graph.instagram.com/v25.0/me/media')
    url.searchParams.set('fields', 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp')
    url.searchParams.set('limit', String(POST_LIMIT))
    const upstream = await fetcher(url.href, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
      // The local workerd runtime supports manual redirects; reject 3xx without forwarding credentials.
      redirect: 'manual',
    })
    if (!upstream.ok) throw new Error('Instagram unavailable')
    const feed = normalizeInstagram(await upstream.json())
    const body = JSON.stringify(feed)
    // Defense in depth against an upstream response reflecting the credential in an allowed field.
    if (body.includes(token) || body.includes(encodeURIComponent(token))) throw new Error('Instagram unavailable')
    response = new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=60, s-maxage=${FRESH_SECONDS}` } })
  } catch {
    // Do not log or forward upstream errors, paging URLs, headers or credentials.
    response = Response.json({ error: 'Instagram is temporarily unavailable.' }, { status: 503, headers: { 'Cache-Control': `public, max-age=0, s-maxage=${FAILURE_SECONDS}`, 'Retry-After': String(FAILURE_SECONDS) } })
  }
  try { await cache?.put(key, response.clone()) } catch { /* Serving the feed still works without cache storage. */ }
  return response
}
