import type { CartIssue } from '../shared/checkout.ts'
export class CheckoutError extends Error {
  status: number
  issues?: CartIssue[]
  constructor(status: number, message: string, issues?: CartIssue[]) {
    super(message)
    this.status = status
    this.issues = issues
  }
}
