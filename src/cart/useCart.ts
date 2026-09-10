import { useEffect, useState } from 'react'
import { CART_KEY, restoreCart, setQuantity } from './cart'

export function useCart() {
  const [items, setItems] = useState(() => {
    try { return restoreCart(localStorage.getItem(CART_KEY)) } catch { return [] }
  })
  useEffect(() => {
    try { localStorage.setItem(CART_KEY, JSON.stringify(items)) } catch { /* Private/full storage: cart still works for this visit. */ }
  }, [items])
  return {
    items,
    count: items.reduce((sum, item) => sum + item.quantity, 0),
    changeQuantity: (id: string, quantity: number) => setItems((current) => setQuantity(current, id, quantity)),
    add: (id: string) => setItems((current) => setQuantity(current, id, (current.find((item) => item.variationId === id)?.quantity ?? 0) + 1)),
  }
}
