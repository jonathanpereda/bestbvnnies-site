import { useEffect, useState } from 'react'
import { formatServiceDuration, formatServicePrice } from '../../shared/services'
import type { ServicesResponse } from '../../shared/services'
import calendarIcon from '../assets/icon-calendar.svg'
import './ServicesSection.css'

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: ServicesResponse }

export function ServicesSection() {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/services', { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error()
      const data = await response.json() as ServicesResponse
      if (!Array.isArray(data.services) || typeof data.bookingUrl !== 'string') throw new Error()
      if (!controller.signal.aborted) setState({ status: 'ready', data })
    }).catch(() => { if (!controller.signal.aborted) setState({ status: 'error' }) })
    return () => controller.abort()
  }, [attempt])
  // A service appears once, under its first Square category; all its category labels remain visible.
  const groups = new Map<string, { name: string; services: ServicesResponse['services'] }>()
  if (state.status === 'ready') for (const service of state.data.services) {
    const category = service.categories[0]
    const key = category?.id ?? 'uncategorized'
    if (!groups.has(key)) groups.set(key, { name: category?.name ?? 'The service menu', services: [] })
    groups.get(key)!.services.push(service)
  }
  return <section id="services" className="services-section" aria-labelledby="services-title">
    <div className="services-intro">
      <div><p className="eyebrow">THE STUDIO MENU</p><h2 id="services-title">Your nails.<br /><span>Your moment.</span></h2></div>
      <div className="services-note"><img src={calendarIcon} alt="" /><p>A little time for you.<br />A lot of personality.</p></div>
    </div>
    <div className="booking-handoff">
      <p>Find your service here. Continue to Square to choose your service and appointment time.</p>
      {state.status === 'ready' && <a className="button" href={state.data.bookingUrl}>Book appointment <span aria-hidden="true">↗</span></a>}
    </div>
    {state.status === 'loading' && <div className="catalog-message" role="status"><h3>Getting the menu ready…</h3><p>Loading services.</p></div>}
    {state.status === 'error' && <div className="catalog-message" role="alert"><h3>A little interruption.</h3><p>We couldn’t load the services. Please try again in a moment.</p><button className="button" onClick={() => { setState({ status: 'loading' }); setAttempt((value) => value + 1) }}>Try services again ↗</button></div>}
    {state.status === 'ready' && <>
      {state.data.services.length === 0 && <div className="catalog-message"><h3>The menu is taking a moment.</h3><p>No online-bookable services are listed here right now. You can check Square for booking details.</p></div>}
      {groups.size > 1 && <nav className="service-category-nav" aria-label="Service categories">{[...groups].map(([key, group], index) => <a key={key} href={`#service-group-${index}`}>{group.name}</a>)}</nav>}
      {[...groups].map(([key, group], index) => <section className="service-group" key={key} id={`service-group-${index}`} aria-labelledby={`service-group-title-${index}`}>
        <h3 id={`service-group-title-${index}`}><span aria-hidden="true">{String(index + 1).padStart(2, '0')} / </span>{group.name}</h3>
        <div>{group.services.map((service) => <article className="service-entry" key={service.id}>
          <div className="service-description"><h4>{service.name}</h4>{service.categories.length > 1 && <p className="service-labels">{service.categories.map((category) => category.name).join(' / ')}</p>}{service.description && <p>{service.description}</p>}</div>
          <ul className="service-variations">{service.variations.map((variation) => <li key={variation.id}>
            {variation.name && (service.variations.length > 1 || !['Regular', service.name].includes(variation.name)) && <p className="service-variation-name">{variation.name}</p>}
            <p className="service-price">{formatServicePrice(variation)}</p><p className="service-duration">{formatServiceDuration(variation.durationMs)}</p>
          </li>)}</ul>
        </article>)}</div>
      </section>)}
      {state.data.services.length > 0 && <div className="services-bottom"><span aria-hidden="true">✳</span><div><h3>Found your moment?</h3><p>Square will confirm current prices, timing and booking policies.</p></div><a className="button" href={state.data.bookingUrl}>Continue to Square ↗</a></div>}
    </>}
  </section>
}
