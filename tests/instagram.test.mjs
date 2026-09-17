import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeInstagram, instagramResponse } from '../worker/instagram.ts'
import { handleApi } from '../worker/api.ts'

const token = 'test-instagram-credential'
const env = { INSTAGRAM_ACCESS_TOKEN: token }
const post = (changes = {}) => ({ id: '123', caption: 'Fresh set ✳', media_type: 'IMAGE', media_url: 'https://scontent.cdninstagram.com/photo.jpg?signature=public-cdn', permalink: 'https://www.instagram.com/p/example/', timestamp: '2026-09-17T10:00:00+0000', ...changes })
const request = (suffix = '') => new Request('https://bestbvnnies.example/api/instagram' + suffix)
const fetchPosts = async () => Response.json({ data: [post()] })

function cacheFixture() {
  const entries = new Map()
  let now = 0
  return {
    entries,
    advance: (seconds) => { now += seconds },
    async match(key) {
      const entry = entries.get(key.url)
      return entry && now < entry.expires ? entry.response.clone() : undefined
    },
    async put(key, response) {
      assert.equal(key.method, 'GET')
      assert.equal([...key.headers].length, 0)
      assert.equal(key.url, 'https://bestbvnnies.example/api/instagram')
      const ttl = Number(response.headers.get('Cache-Control').match(/s-maxage=(\d+)/)[1])
      entries.set(key.url, { response: response.clone(), expires: now + ttl })
    },
  }
}

test('normalizes images, carousel covers and video thumbnails; never forwards video URLs or paging', () => {
  const feed = normalizeInstagram({ data: [post({ id: 'image' }), post({ id: 'carousel', media_type: 'CAROUSEL_ALBUM' }), post({ id: 'video', media_type: 'VIDEO', media_url: 'https://scontent.cdninstagram.com/video.mp4', thumbnail_url: 'https://scontent.fbcdn.net/thumb.jpg', owner: 'private' })], paging: { next: 'https://example.com/?access_token=secret' } })
  assert.equal(feed.posts.length, 3)
  assert.equal(feed.posts[2].displayUrl, 'https://scontent.fbcdn.net/thumb.jpg')
  assert.equal(feed.posts[2].mediaType, 'VIDEO')
  assert.deepEqual(Object.keys(feed.posts[0]).sort(), ['id', 'caption', 'mediaType', 'displayUrl', 'permalink', 'timestamp'].sort())
  assert.equal(JSON.stringify(feed).includes('video.mp4'), false)
  assert.equal(JSON.stringify(feed).includes('secret'), false)
})

test('missing preview still links to the post and missing optional fields are safe', () => {
  const value = normalizeInstagram({ data: [post({ media_type: 'VIDEO', thumbnail_url: null, caption: 42, timestamp: 'bad' })] }).posts[0]
  assert.equal(value.displayUrl, null)
  assert.equal(value.caption, null)
  assert.equal(value.timestamp, null)
  assert.equal(value.permalink, post().permalink)
  assert.equal(normalizeInstagram({ data: [post({ caption: 'x'.repeat(1000) })] }).posts[0].caption.length, 500)
})

test('rejects unsafe external destinations and skips malformed or unsupported posts', () => {
  for (const permalink of ['javascript:alert(1)', 'http://www.instagram.com/p/abc/', 'https://www.instagram.com.evil.test/p/abc/', 'https://user:password@www.instagram.com/p/abc/', 'https://www.instagram.com/accounts/login/', 'https://www.instagram.com/p/abc/?access_token=secret']) assert.deepEqual(normalizeInstagram({ data: [post({ permalink })] }).posts, [])
  for (const media_url of ['http://scontent.cdninstagram.com/photo.jpg', 'https://cdninstagram.com.evil.test/x', 'https://example.com/photo.jpg', 'data:image/svg+xml,x', 'https://scontent.cdninstagram.com/cover.mp4', 'https://scontent.fbcdn.net/x?access_token=secret']) assert.equal(normalizeInstagram({ data: [post({ media_url })] }).posts[0].displayUrl, null)
  assert.deepEqual(normalizeInstagram({ data: [null, {}, post({ id: '' }), post({ media_type: 'UNKNOWN' })] }), { posts: [] })
  assert.equal(normalizeInstagram({ data: [post({ permalink: post().permalink + '?utm_source=feed#extra' })] }).posts[0].permalink, post().permalink)
})

test('deduplicates, sorts newest first and caps output at six without following pagination', () => {
  const data = Array.from({ length: 9 }, (_, i) => post({ id: String(i), timestamp: `2026-09-${String(i + 1).padStart(2, '0')}T12:00:00Z` }))
  const result = normalizeInstagram({ data: [...data, data[0]] })
  assert.deepEqual(result.posts.map(p => p.id), ['8', '7', '6', '5', '4', '3'])
  assert.deepEqual(normalizeInstagram({ data: [] }), { posts: [] })
  for (const value of [null, {}, { data: {} }, { data: [], error: { message: 'private' } }]) assert.throws(() => normalizeInstagram(value))
})

test('requests only six posts with bearer header, pinned API version, timeout and no token in URL', async () => {
  const response = await instagramResponse(request(), env, undefined, async (input, options) => {
    const url = new URL(input)
    assert.equal(url.origin + url.pathname, 'https://graph.instagram.com/v25.0/me/media')
    assert.equal(url.searchParams.get('limit'), '6')
    assert.equal(url.searchParams.get('fields'), 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp')
    assert.equal(url.href.includes(token), false)
    assert.equal(options.headers.Authorization, `Bearer ${token}`)
    assert.ok(options.signal instanceof AbortSignal)
    assert.equal(options.redirect, 'manual')
    return fetchPosts()
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60, s-maxage=900')
  assert.equal((await response.text()).includes(token), false)
})

test('cache hits ignore visitor query/header variations and refresh after fifteen minutes', async () => {
  const cache = cacheFixture()
  let calls = 0
  const fetcher = async () => { calls++; return fetchPosts() }
  const first = await instagramResponse(request('?cachebust=1'), env, cache, fetcher)
  const second = await instagramResponse(new Request(request('?cachebust=2'), { headers: { Cookie: 'private', Authorization: 'visitor-secret' } }), env, cache, fetcher)
  assert.equal(calls, 1)
  assert.deepEqual(await first.json(), await second.json())
  cache.advance(901)
  await instagramResponse(request(), env, cache, fetcher)
  assert.equal(calls, 2)
})

test('HTTP, expired token, network, timeout, malformed JSON and reflected-secret failures are sanitized', async () => {
  const failures = [
    async () => new Response('private-token-details', { status: 401 }),
    async () => new Response('', { status: 302, headers: { Location: 'https://example.com' } }),
    async () => new Response('rate limited', { status: 429 }),
    async () => { throw new Error(token) },
    async () => { throw new DOMException(token, 'TimeoutError') },
    async () => new Response('not json'),
    async () => Response.json({ error: { message: token } }),
    async () => Response.json({ data: [post({ caption: token })] }),
    async () => Response.json({ data: [post({ media_url: `https://scontent.fbcdn.net/${token}.jpg` })] }),
  ]
  for (const fail of failures) {
    const response = await instagramResponse(request(), env, undefined, fail)
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'Instagram is temporarily unavailable.' })
  }
})

test('short failure cache avoids hitting Instagram repeatedly and permits recovery', async () => {
  const cache = cacheFixture()
  let calls = 0
  const fetcher = async () => { calls++; return calls === 1 ? new Response('', { status: 500 }) : fetchPosts() }
  assert.equal((await instagramResponse(request(), env, cache, fetcher)).status, 503)
  assert.equal((await instagramResponse(request(), env, cache, fetcher)).status, 503)
  assert.equal(calls, 1)
  cache.advance(61)
  assert.equal((await instagramResponse(request(), env, cache, fetcher)).status, 200)
  assert.equal(calls, 2)
})

test('cache failures do not break a valid feed; missing token performs no upstream request', async () => {
  const cache = { match: async () => { throw new Error('cache down') }, put: async () => { throw new Error('cache down') } }
  assert.equal((await instagramResponse(request(), env, cache, fetchPosts)).status, 200)
  const missing = await instagramResponse(request(), {}, cache, async () => { assert.fail('Must not fetch') })
  assert.equal(missing.status, 503)
  assert.equal(missing.headers.get('Cache-Control'), 'no-store')
})

test('route accepts GET only and is independent of Square configuration', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
    const response = await handleApi(new Request(request(), { method }), env)
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('Allow'), 'GET')
  }
  assert.equal((await handleApi(request(), {})).status, 503)
  assert.equal((await handleApi(new Request('http://localhost/api/health'), {})).status, 200)
})
