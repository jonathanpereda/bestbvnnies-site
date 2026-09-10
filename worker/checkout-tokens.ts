import { required, SquareError } from './square/client.ts'
import type { SquareEnv } from './square/client.ts'
import { CheckoutError } from './checkout-errors.ts'
const encoder = new TextEncoder()
function base64(bytes: Uint8Array): string { return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') }
function bytes(value: string): Uint8Array { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0)) }
async function key(env: SquareEnv) {
  const secret = required(env.CHECKOUT_TOKEN_SECRET)
  if (secret.length < 32) throw new SquareError(500)
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', encoder.encode(secret)), 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function digest(value: unknown) { return base64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(value))))) }
export async function seal(value: unknown, purpose: string, env: SquareEnv) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`bestbvnnies:${purpose}:${env.SQUARE_ENVIRONMENT}:${env.SQUARE_LOCATION_ID}:v1`) }, await key(env), encoder.encode(JSON.stringify(value)))
  return `${base64(iv)}.${base64(new Uint8Array(ciphertext))}`
}
export async function unseal<T>(value: unknown, purpose: string, env: SquareEnv): Promise<T> {
  const secret = await key(env)
  try {
    if (typeof value !== 'string' || value.length > 120_000 || value.split('.').length !== 2) throw new Error()
    const [iv, ciphertext] = value.split('.')
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv), additionalData: encoder.encode(`bestbvnnies:${purpose}:${env.SQUARE_ENVIRONMENT}:${env.SQUARE_LOCATION_ID}:v1`) }, secret, bytes(ciphertext))
    return JSON.parse(new TextDecoder().decode(plaintext)) as T
  } catch { throw new CheckoutError(400, 'This checkout reference is invalid. Please review your bag again.') }
}
