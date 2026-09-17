import { useEffect, useState } from 'react'
import { FaInstagram, FaTiktok, FaEnvelope } from 'react-icons/fa'

import bunnyOff from '../assets/bunny-light-off.svg'
import bunnyPink from '../assets/bunny-light-pink.svg'
import bunnyGreen from '../assets/bunny-light-green.svg'
import bunnyBlue from '../assets/bunny-light-blue.svg'

const bunnyLights = [
  bunnyPink,
  bunnyGreen,
  bunnyBlue,
]

export function SiteFooter() {
  const [offIndex, setOffIndex] = useState(0)

  useEffect(() => {
    const interval = window.setInterval(() => {
      setOffIndex((current) => (current + 1) % bunnyLights.length)
    }, 700)

    return () => window.clearInterval(interval)
  }, [])

  return (
    <footer className="site-footer">
      <div className="footer-bunnies" aria-hidden="true">
        {bunnyLights.map((bunny, index) => (
          <img
            key={bunny}
            src={offIndex === index ? bunny : bunnyOff}
            alt=""
          />
        ))}
      </div>

      <div className="footer-socials" aria-label="Bestbvnnies social links">
        <a
          href="https://www.instagram.com/bestbvnnies"
          target="_blank"
          rel="noreferrer"
          aria-label="Bestbvnnies on Instagram"
        >
          <FaInstagram />
        </a>

        <a
          href="https://www.tiktok.com/@bestbvnnies"
          target="_blank"
          rel="noreferrer"
          aria-label="Bestbvnnies on TikTok"
        >
          <FaTiktok />
        </a>

        <a
          href="mailto:bestbvnnies@gmail.com"
          aria-label="Email Bestbvnnies"
        >
          <FaEnvelope />
        </a>
      </div>

      <a className="footer-top-link" href="#top">
        Back to top ↑
      </a>
    </footer>
  )
}