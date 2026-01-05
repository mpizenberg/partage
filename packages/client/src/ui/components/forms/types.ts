import type { ExpenseCategory, Payer, Beneficiary } from '@partage/shared'

export interface ExpenseFormData {
  amount: number
  description: string
  currency: string
  date: number
  category?: ExpenseCategory
  location?: string
  notes?: string
  payers: Payer[]
  beneficiaries: Beneficiary[]
}

export interface TransferFormData {
  amount: number
  currency: string
  from: string
  to: string
  date: number
  notes?: string
}

export interface FormErrors {
  [key: string]: string | undefined
}
