import { useEffect, useState } from 'react'
import type { InstagramFeed, InstagramPost } from '../../shared/instagram'
import './InstagramSection.css'

const profileUrl = 'https://www.instagram.com/bestbvnnies'
type FeedState = { status: 'loading' } | { status: 'unavailable' } | { status: 'ready'; posts: InstagramPost[] }
const mediaLabel = (type: InstagramPost['mediaType']) => type === 'VIDEO' ? 'Reel / video' : type === 'CAROUSEL_ALBUM' ? 'Photo diary' : 'Snapshot'

function InstagramPhoto({ post, index }: { post: InstagramPost; index: number }) {
  const [imageFailed, setImageFailed] = useState(false)
  const date = post.timestamp ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(post.timestamp)) : null
  const label = mediaLabel(post.mediaType)
  return <li className="instagram-post">
    <figure>
      <a className="instagram-frame" href={post.permalink} target="_blank" rel="noopener noreferrer"
        aria-label={`View @bestbvnnies ${label.toLowerCase()} ${index + 1}${date ? ` from ${date}` : ''} on Instagram (opens in a new tab)`}>
        <span className="instagram-number" aria-hidden="true">NO. {String(index + 1).padStart(2, '0')}</span>
        <div className="instagram-photo">
          {post.displayUrl && !imageFailed ? <img src={post.displayUrl} alt={post.caption?.slice(0, 160) ?? 'From the bestbvnnies Instagram feed'} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /> :
            <div className="instagram-image-fallback"><span aria-hidden="true">✳︎</span><p>Catch this one<br />on Instagram.</p></div>}
        </div>
        <span className="instagram-photo-label"><span>{label}</span><span aria-hidden="true">↗︎</span></span>
      </a>
      <figcaption>{date && <time dateTime={post.timestamp!}>{date}</time>}{post.caption && <p>{post.caption.length > 140 ? `${post.caption.slice(0, 137)}…` : post.caption}</p>}</figcaption>
    </figure>
  </li>
}

export function InstagramSection() {
  const [feed, setFeed] = useState<FeedState>({ status: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/instagram', { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Feed unavailable')
      const data = await response.json() as InstagramFeed
      if (!Array.isArray(data.posts)) throw new Error('Feed unavailable')
      if (!controller.signal.aborted) setFeed({ status: 'ready', posts: data.posts })
    }).catch(() => { if (!controller.signal.aborted) setFeed({ status: 'unavailable' }) })
    return () => controller.abort()
  }, [])

  return <section className="instagram-section" id="instagram" aria-labelledby="instagram-title">
    <div className="instagram-edition"><span>LATEST FROM INSTAGRAM</span><span>@BESTBVNNIES</span></div>
    <div className="instagram-heading">
      <h2 id="instagram-title">ON THE<br /><span>FEED.</span></h2>
      <div className="instagram-intro"><p>The sets. The details.<br />The very best bits.</p><span className="instagram-sticker" aria-hidden="true">LOOKS GOOD<br />ON YOU. ✳︎</span></div>
    </div>
    {feed.status === 'loading' && <div className="instagram-loading" role="status"><p>Pinning up the latest…</p><div className="instagram-placeholders" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i}>✳︎</span>)}</div></div>}
    {feed.status === 'ready' && feed.posts.length > 0 && <ul className="instagram-grid">{feed.posts.map((post, index) => <InstagramPhoto post={post} index={index} key={post.id} />)}</ul>}
    {(feed.status === 'unavailable' || (feed.status === 'ready' && !feed.posts.length)) && <div className="instagram-unavailable" role="status"><span aria-hidden="true">✳︎</span><div><h3>More good stuff over there.</h3><p>{feed.status === 'unavailable' ? 'The feed is taking a moment. Find the latest on Instagram.' : 'Our next photo diary is coming. Find us on Instagram in the meantime.'}</p></div></div>}
    <div className="instagram-follow"><p>Stay in the loop.<br /><strong>Come hang with the bvnnies.</strong></p><a className="instagram-follow-link" href={profileUrl} target="_blank" rel="noopener noreferrer">Follow @bestbvnnies <span aria-hidden="true">↗︎</span><span className="sr-only"> on Instagram (opens in a new tab)</span></a></div>
  </section>
}
