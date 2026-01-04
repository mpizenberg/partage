/**
 * Balance calculation types
 */

export interface Balance {
  memberId: string;
  totalPaid: number;
  totalOwed: number;
  netBalance: number; // Positive = owed money, Negative = owes money
}

export interface DebtEdge {
  from: string; // Member ID who owes
  to: string; // Member ID who is owed
  amount: number;
}

export interface SettlementPlan {
  transactions: DebtEdge[];
  totalTransactions: number;
}

export type SettlementConstraintType = 'must' | 'must-not' | 'prefer';

export interface SettlementConstraint {
  type: SettlementConstraintType;
  from: string; // Member ID
  to: string; // Member ID
}
