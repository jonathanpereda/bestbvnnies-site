import { useEffect, useState } from 'react'
import type { ProductsResponse } from '../shared/products'
import { InstagramSection } from './components/InstagramSection'
import { ServicesSection } from './components/ServicesSection'
import { SiteHeader } from './components/SiteHeader'
import { SiteFooter } from './components/SiteFooter'
import { ProductCard } from './components/ProductCard'
import { CartPanel } from './components/CartPanel'
import { useCart } from './cart/useCart'
import type { CheckoutQuote } from '../shared/checkout'
import pressonsIcon from './assets/icon-pressons.svg'
import star from './assets/star.svg'
import './App.css'

type CatalogState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: ProductsResponse }

function App() {
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const cart = useCart()
  const [cartOpen, setCartOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  function applyQuote(quote: CheckoutQuote) {
    setCatalog((current) => current.status !== 'ready' ? current : { ...current, data: { ...current.data, products: current.data.products.map((product) => ({ ...product,
      name: quote.lines.find((line) => line.productId === product.id)?.name ?? product.name,
      variations: product.variations.map((variation) => {
        const line = quote.lines.find((entry) => entry.variationId === variation.id)
        return line ? { ...variation, price: line.unitPrice, inventory: line.inventory, imageUrl: line.imageUrl, name: line.variationName } : variation
      }),
    })) } })
  }
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/products', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Catalog unavailable')
        const data = await response.json() as ProductsResponse
        if (!Array.isArray(data.products)) throw new Error('Invalid catalog')
        if (!controller.signal.aborted) setCatalog({ status: 'ready', data })
      })
      .catch(() => { if (!controller.signal.aborted) setCatalog({ status: 'error' }) })
    return () => controller.abort()
  }, [attempt])

  return (
    <>
      <a className="skip-link" href="#shop">Skip to products</a>
      <SiteHeader count={cart.count} onOpenCart={() => setCartOpen(true)} />
      <p className="sr-only" role="status">{announcement}</p>
      <main>
        <section className="editorial" aria-labelledby="intro-title">
          <div className="edition-line"><span>THE BESTBVNNIES EDIT</span><span>NAILS WITH PERSONALITY</span></div>
          <div className="headline-wrap">
            <h1 id="intro-title">BEST DAMN NAILS<br /><span>IN THE WEST.</span></h1>
            <span className="editorial-sticker" aria-hidden="true">supa<br /><em>cool.</em> ✳︎</span>
          </div>
          <div className="intro-bottom"><p>You won't just find nails, you'll find yourself.</p><a className="shop-link" href="#shop">Explore the shop <span aria-hidden="true">↓</span></a></div>
        </section>
        <div className="hero-shop-transition">
          <img
            className="transition-star"
            src={star}
            alt=""
            aria-hidden="true"
          />
          <div className="ticker" aria-hidden="true">
            <div className="ticker-track">
              <span>
                ✳︎ BESTBVNNIES ✳︎ LOCALLY-OWNED ✳︎ BESTBVNNIES ✳︎ WOMAN-OWNED ✳︎ BESTBVNNIES ✳︎ THE-BEST-BUNNIES ✳︎ BESTBVNNIES ✳︎ EST. 1989 
              </span>
              <span>
                ✳︎ BESTBVNNIES ✳︎ LOCALLY-OWNED ✳︎ BESTBVNNIES ✳︎ WOMAN-OWNED ✳︎ BESTBVNNIES ✳︎ THE-BEST-BUNNIES ✳︎ BESTBVNNIES ✳︎ EST. 1989 
              </span>
            </div>
          </div>
        </div>
        <section className="shop-section" id="shop" aria-labelledby="shop-title">
          <div className="shop-heading"><div><p className="eyebrow">THE COLLECTION</p><h2 id="shop-title">Good taste.<br /><span>At your fingertips.</span></h2></div><p className="shop-note">Find your next favorite.<br />Make it your own.</p></div>
          <div className="catalog-bar"><span className="collection-label"><img src={pressonsIcon} alt="Press-on nails" />THE SHOP</span><span aria-live="polite">{catalog.status === 'ready' ? `${catalog.data.products.length} ${catalog.data.products.length === 1 ? 'product' : 'products'}` : 'THE BESTBVNNIES COLLECTION'}</span></div>
          {catalog.status === 'loading' && <div className="catalog-message" role="status"><span className="state-symbol" aria-hidden="true">✳︎</span><h3>Finding your next favorites…</h3><p>Loading the collection.</p></div>}
          {catalog.status === 'error' && <div className="catalog-message" role="alert"><span className="state-symbol" aria-hidden="true">↻</span><h3>A little interruption.</h3><p>We couldn’t load the collection. Please try again in a moment.</p><button className="button" onClick={() => { setCatalog({ status: 'loading' }); setAttempt((value) => value + 1) }}>Try again <span aria-hidden="true">↗︎</span></button></div>}
          {catalog.status === 'ready' && <>
            {catalog.data.inventoryUnavailable && <p className="inventory-notice" role="status">Stock information is temporarily unavailable. Product details are still available to browse.</p>}
            {catalog.data.products.length === 0 ? <div className="catalog-message"><span className="state-symbol" aria-hidden="true">✳︎</span><h3>Room for something good.</h3><p>There are no products in the collection right now. Check back soon.</p></div> :
              <div className="product-grid">{catalog.data.products.map((product, index) => <ProductCard key={product.id} product={product} index={index} items={cart.items} onAdd={(id) => { cart.add(id); setAnnouncement(`${product.name} added to your bag. ${cart.count + 1} items in bag.`) }} />)}</div>}
          </>}
        </section>
        <ServicesSection />
        <InstagramSection />
      </main>
      <SiteFooter />
      {cartOpen && <CartPanel items={cart.items} products={catalog.status === 'ready' ? catalog.data.products : []} catalogReady={catalog.status === 'ready'} onQuantity={cart.changeQuantity} onClose={() => setCartOpen(false)} onValidated={applyQuote} onPurchased={cart.clear} />}
    </>
  )
}

export default App
