export type InstagramPost = {
  id: string
  caption: string | null
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'
  displayUrl: string | null
  permalink: string
  timestamp: string | null
}

export type InstagramFeed = { posts: InstagramPost[] }
