import wordmark from '../assets/bestbvnnies-wordmark.svg'

export function SiteHeader({ count, onOpenCart }: { count: number; onOpenCart: () => void }) {
  return (
    <header className="site-header" id="top">
      <a className="wordmark" href="#top" aria-label="bestbvnnies home"><img src={wordmark} alt="bestbvnnies" /></a>
      <nav aria-label="Main navigation"><a href="#shop">The shop <span aria-hidden="true">↗</span></a><button className="bag-button" onClick={onOpenCart} aria-label={`Open shopping bag, ${count} ${count === 1 ? 'item' : 'items'}`} aria-haspopup="dialog">Bag <span>{count}</span></button></nav>
    </header>
  )
}
