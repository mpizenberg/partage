import { describe, it, expect } from 'vitest';
import {
  calculateBalances,
  buildDebtGraph,
  generateSettlementPlan,
  getTotalSettlementAmount,
  isBalanceSettled,
  areAllBalancesSettled,
} from './balance-calculator';
import type { ExpenseEntry, TransferEntry, Entry } from '@partage/shared';

describe('Balance Calculator', () => {
  const groupId = 'test-group';
  const now = Date.now();

  describe('calculateBalances', () => {
    it('should calculate balances for a simple expense', () => {
      const entries: Entry[] = [
        {
          id: 'e1',
          groupId,
          type: 'expense',
          version: 1,
          createdAt: now,
          createdBy: 'member-1',
          status: 'active',
          description: 'Dinner',
          amount: 100,
          currency: 'USD',
          date: now,
          payers: [{ memberId: 'member-1', amount: 100 }],
          beneficiaries: [
            { memberId: 'member-1', splitType: 'shares', shares: 1 },
            { memberId: 'member-2', splitType: 'shares', shares: 1 },
          ],
        } as ExpenseEntry,
      ];

      const balances = calculateBalances(entries);

      expect(balances.size).toBe(2);

      const balance1 = balances.get('member-1');
      expect(balance1?.totalPaid).toBe(100);
      expect(balance1?.totalOwed).toBe(50);
      expect(balance1?.netBalance).toBe(50);

      const balance2 = balances.get('member-2');
      expect(balance2?.totalPaid).toBe(0);
      expect(balance2?.totalOwed).toBe(50);
      expect(balance2?.netBalance).toBe(-50);
    });

    it('should handle multiple expenses', () => {
      const entries: Entry[] = [
        {
          id: 'e1',
          groupId,
          type: 'expense',
          version: 1,
          createdAt: now,
          createdBy: 'member-1',
          status: 'active',
          description: 'Lunch',
          amount: 60,
          currency: 'USD',
          date: now,
          payers: [{ memberId: 'member-1', amount: 60 }],
          beneficiaries: [
            { memberId: 'member-1', splitType: 'shares', shares: 1 },
            { memberId: 'member-2', splitType: 'shares', shares: 1 },
            { memberId: 'member-3', splitType: 'shares', shares: 1 },
          ],
        } as ExpenseEntry,
        {
          id: 'e2',
          groupId,
          type: 'expense',
          version: 1,
          createdAt: now,
          createdBy: 'member-2',
          status: 'active',
          description: 'Taxi',
          amount: 30,
          currency: 'USD',
          date: now,
          payers: [{ memberId: 'member-2', amount: 30 }],
          beneficiaries: [
            { memberId: 'member-1', splitType: 'shares', shares: 1 },
            { memberId: 'member-2', splitType: 'shares', shares: 1 },
            { memberId: 'member-3', splitType: 'shares', shares: 1 },
          ],
        } as ExpenseEntry,
      ];

      const balances = calculateBalances(entries);

      const balance1 = balances.get('member-1');
      expect(balance1?.totalPaid).toBe(60);
      expect(balance1?.totalOwed).toBe(30); // 20 from lunch + 10 from taxi
      expect(balance1?.netBalance).toBe(30);

      const balance2 = balances.get('member-2');
      expect(balance2?.totalPaid).toBe(30);
      expect(balance2?.totalOwed).toBe(30); // 20 from lunch + 10 from taxi
      expect(balance2?.netBalance).toBe(0);

      const balance3 = balances.get('member-3');
      expect(balance3?.totalPaid).toBe(0);
      expect(balance3?.totalOwed).toBe(30); // 20 from lunch + 10 from taxi
      expect(balance3?.netBalance).toBe(-30);
    });

    it('should handle exact split amounts', () => {
      const entries: Entry[] = [
        {
          id: 'e1',
          groupId,
          type: 'expense',
          version: 1,
          createdAt: now,
          createdBy: 'member-1',
          status: 'active',
          description: 'Shopping',
          amount: 100,
          currency: 'USD',
          date: now,
          payers: [{ memberId: 'member-1', amount: 100 }],
          beneficiaries: [
            { memberId: 'member-1', splitType: 'exact', amount: 30 },
            { memberId: 'member-2', splitType: 'exact', amount: 70 },
          ],
        } as ExpenseEntry,
      ];

      const balances = calculateBalances(entries);

      const balance1 = balances.get('member-1');
      expect(balance1?.totalPaid).toBe(100);
      expect(balance1?.totalOwed).toBe(30);
      expect(balance1?.netBalance).toBe(70);

      const balance2 = balances.get('member-2');
      expect(balance2?.totalPaid).toBe(0);
      expect(balance2?.totalOwed).toBe(70);
      expect(balance2?.netBalance).toBe(-70);
    });

    it('should handle mixed split types', () => {
      const entries: Entry[] = [
        {
          id: 'e1',
          groupId,
          type: 'expense',
          version: 1,
          createdAt: now,
          createdBy: 'member-1',
          status: 'active',
          description: 'Mixed',
          amount: 150,
          currency: 'USD',
          date: now,
          payers: [{ memberId: 'member-1', amount: 150 }],
          beneficiaries: [
            { memberId: 'member-1', splitType: 'exact', amount: 50 },
            { memberId: 'member-2', splitType: 'shares', shares: 2 },
            { memberId: 'member-3', splitType: 'shares', shares: 1 },
          ],
        } as ExpenseEntry,
      ];

      const balances = calculateBalances(entries);

      const balance1 = balances.get('member-1');
      expect(balance1?.totalOwed).toBe(50);

      const balance2 = balances.get('member-2');
      // 100 remaining after exact, split 2:1, so member-2 gets 66.67
      expect(balance2?.totalOwed).toBeCloseTo(66.67, 1);

      const balance3 = balances.get('member-3');
      // member-3 gets 33.33
      expect(balance3?.totalOwed).toBeCloseTo(33.33, 1);
    });

    it('should handle transfers', () => {
      const entries: Entry[] = [
        {
          id: 't1',
          groupId,
          type: 'transfer',
          version: 1,
          createdAt: now,
          createdBy: 'member-1',
          status: 'active',
          from: 'member-1',
          to: 'member-2',
          amount: 50,
          currency: 'USD',
          date: now,
        } as TransferEntry,
      ];

      const balances = calculateBalances(entries);

      const balance1 = balances.get('member-1');
      expect(balance1?.totalPaid).toBe(50);
      expect(balance1?.totalOwed).toBe(0);
      expect(balance1?.netBalance).toBe(50);

      const balance2 = balances.get('member-2');
      expect(balance2?.totalPaid).toBe(0);
      expect(balance2?.totalOwed).toBe(50);
      expect(balance2?.netBalance).toBe(-50);
    });

    it('should handle multiple payers', () => {
      const entries: Entry[] = [
        {
          id: 'e1',
          groupId,
          type: 'expense',
          version: 1,
          createdAt: now,
          createdBy: 'member-1',
          status: 'active',
          description: 'Split payment',
          amount: 200,
          currency: 'USD',
          date: now,
          payers: [
            { memberId: 'member-1', amount: 120 },
            { memberId: 'member-2', amount: 80 },
          ],
          beneficiaries: [
            { memberId: 'member-1', splitType: 'shares', shares: 1 },
            { memberId: 'member-2', splitType: 'shares', shares: 1 },
          ],
        } as ExpenseEntry,
      ];

      const balances = calculateBalances(entries);

      const balance1 = balances.get('member-1');
      expect(balance1?.totalPaid).toBe(120);
      expect(balance1?.totalOwed).toBe(100);
      expect(balance1?.netBalance).toBe(20);

      const balance2 = balances.get('member-2');
      expect(balance2?.totalPaid).toBe(80);
      expect(balance2?.totalOwed).toBe(100);
      expect(balance2?.netBalance).toBe(-20);
    });

    it('should ignore deleted entries', () => {
      const entries: Entry[] = [
        {
          id: 'e1',
          groupId,
          type: 'expense',
          version: 1,
          createdAt: now,
          createdBy: 'member-1',
          status: 'deleted',
          deletedAt: now,
          deletedBy: 'member-1',
          description: 'Deleted',
          amount: 100,
          currency: 'USD',
          date: now,
          payers: [{ memberId: 'member-1', amount: 100 }],
          beneficiaries: [{ memberId: 'member-2', splitType: 'exact', amount: 100 }],
        } as ExpenseEntry,
      ];

      const balances = calculateBalances(entries);

      // Should have no balances since the only entry is deleted
      expect(balances.size).toBe(0);
    });

    it('should use default currency amount when available', () => {
      const entries: Entry[] = [
        {
          id: 'e1',
          groupId,
          type: 'expense',
          version: 1,
          createdAt: now,
          createdBy: 'member-1',
          status: 'active',
          description: 'Euro expense',
          amount: 100,
          currency: 'EUR',
          defaultCurrencyAmount: 110,
          exchangeRate: 1.1,
          date: now,
          payers: [{ memberId: 'member-1', amount: 100 }],
          beneficiaries: [
            { memberId: 'member-1', splitType: 'shares', shares: 1 },
            { memberId: 'member-2', splitType: 'shares', shares: 1 },
          ],
        } as ExpenseEntry,
      ];

      const balances = calculateBalances(entries);

      const balance1 = balances.get('member-1');
      // Paid 110 (converted), owes 55
      expect(balance1?.totalPaid).toBeCloseTo(110, 2);
      expect(balance1?.totalOwed).toBeCloseTo(55, 2);
      expect(balance1?.netBalance).toBeCloseTo(55, 2);
    });
  });

  describe('buildDebtGraph', () => {
    it('should build a simple debt graph', () => {
      const balances = new Map([
        ['member-1', { memberId: 'member-1', totalPaid: 100, totalOwed: 50, netBalance: 50 }],
        ['member-2', { memberId: 'member-2', totalPaid: 0, totalOwed: 50, netBalance: -50 }],
      ]);

      const debtGraph = buildDebtGraph(balances);

      expect(debtGraph.length).toBe(1);
      expect(debtGraph[0]).toEqual({
        from: 'member-2',
        to: 'member-1',
        amount: 50,
      });
    });

    it('should build a complex debt graph', () => {
      const balances = new Map([
        ['member-1', { memberId: 'member-1', totalPaid: 100, totalOwed: 30, netBalance: 70 }],
        ['member-2', { memberId: 'member-2', totalPaid: 50, totalOwed: 60, netBalance: -10 }],
        ['member-3', { memberId: 'member-3', totalPaid: 30, totalOwed: 90, netBalance: -60 }],
      ]);

      const debtGraph = buildDebtGraph(balances);

      expect(debtGraph.length).toBe(2);

      // member-3 owes the most, should pay first
      const debt1 = debtGraph.find((d) => d.from === 'member-3');
      expect(debt1).toBeDefined();
      expect(debt1?.to).toBe('member-1');
      expect(debt1?.amount).toBe(60);

      // member-2 owes 10 to member-1
      const debt2 = debtGraph.find((d) => d.from === 'member-2');
      expect(debt2).toBeDefined();
      expect(debt2?.to).toBe('member-1');
      expect(debt2?.amount).toBe(10);
    });

    it('should handle balanced accounts', () => {
      const balances = new Map([
        ['member-1', { memberId: 'member-1', totalPaid: 50, totalOwed: 50, netBalance: 0 }],
        ['member-2', { memberId: 'member-2', totalPaid: 50, totalOwed: 50, netBalance: 0 }],
      ]);

      const debtGraph = buildDebtGraph(balances);

      expect(debtGraph.length).toBe(0);
    });

    it('should minimize transactions', () => {
      // Three people: A paid 90, B paid 60, C paid 0
      // All should split 150 equally (50 each)
      const balances = new Map([
        ['A', { memberId: 'A', totalPaid: 90, totalOwed: 50, netBalance: 40 }],
        ['B', { memberId: 'B', totalPaid: 60, totalOwed: 50, netBalance: 10 }],
        ['C', { memberId: 'C', totalPaid: 0, totalOwed: 50, netBalance: -50 }],
      ]);

      const debtGraph = buildDebtGraph(balances);

      // Should have exactly 2 transactions (not 3)
      expect(debtGraph.length).toBe(2);

      // C owes 40 to A and 10 to B
      expect(debtGraph).toContainEqual({ from: 'C', to: 'A', amount: 40 });
      expect(debtGraph).toContainEqual({ from: 'C', to: 'B', amount: 10 });
    });

    it('should round amounts to 2 decimals', () => {
      const balances = new Map([
        ['member-1', { memberId: 'member-1', totalPaid: 100, totalOwed: 33.333, netBalance: 66.667 }],
        ['member-2', { memberId: 'member-2', totalPaid: 0, totalOwed: 33.333, netBalance: -33.333 }],
        ['member-3', { memberId: 'member-3', totalPaid: 0, totalOwed: 33.334, netBalance: -33.334 }],
      ]);

      const debtGraph = buildDebtGraph(balances);

      debtGraph.forEach((edge) => {
        // Check that amount has at most 2 decimal places
        expect(edge.amount).toBe(Math.round(edge.amount * 100) / 100);
      });
    });
  });

  describe('generateSettlementPlan', () => {
    it('should generate a settlement plan', () => {
      const balances = new Map([
        ['member-1', { memberId: 'member-1', totalPaid: 100, totalOwed: 50, netBalance: 50 }],
        ['member-2', { memberId: 'member-2', totalPaid: 0, totalOwed: 50, netBalance: -50 }],
      ]);

      const plan = generateSettlementPlan(balances);

      expect(plan.totalTransactions).toBe(1);
      expect(plan.transactions[0]).toEqual({
        from: 'member-2',
        to: 'member-1',
        amount: 50,
      });
    });

  });

  it('should handle rounding correctly for 3-way split of $100', () => {
      const entries: Entry[] = [
        {
          id: 'e1',
          groupId,
          type: 'expense',
          version: 1,
          createdAt: now,
          createdBy: 'member-1',
          status: 'active',
          description: '$100 split 3 ways',
          amount: 100,
          currency: 'USD',
          date: now,
          payers: [{ memberId: 'member-1', amount: 100 }],
          beneficiaries: [
            { memberId: 'alice', splitType: 'shares', shares: 1 },
            { memberId: 'bob', splitType: 'shares', shares: 1 },
            { memberId: 'charlie', splitType: 'shares', shares: 1 },
          ],
        } as ExpenseEntry,
      ];

      const balances = calculateBalances(entries);

      // Total owed should equal total paid (no rounding error)
      const totalOwed = Array.from(balances.values()).reduce((sum, b) => sum + b.totalOwed, 0);
      const totalPaid = Array.from(balances.values()).reduce((sum, b) => sum + b.totalPaid, 0);

      expect(totalOwed).toBe(100);
      expect(totalPaid).toBe(100);

      // Verify individual splits sum to exactly $100
      const alice = balances.get('alice');
      const bob = balances.get('bob');
      const charlie = balances.get('charlie');

      const splitSum = (alice?.totalOwed ?? 0) + (bob?.totalOwed ?? 0) + (charlie?.totalOwed ?? 0);
      expect(splitSum).toBe(100);

      // Splits should be deterministic: sorted by member ID, remainder goes to first members
      // alice gets $33.34, bob gets $33.33, charlie gets $33.33
      expect(alice?.totalOwed).toBe(33.34);
      expect(bob?.totalOwed).toBe(33.33);
      expect(charlie?.totalOwed).toBe(33.33);
    });

    it('should handle rounding correctly for 3-way split of $200', () => {
      const entries: Entry[] = [
        {
          id: 'e1',
          groupId,
          type: 'expense',
          version: 1,
          createdAt: now,
          createdBy: 'member-1',
          status: 'active',
          description: '$200 split 3 ways',
          amount: 200,
          currency: 'USD',
          date: now,
          payers: [{ memberId: 'member-1', amount: 200 }],
          beneficiaries: [
            { memberId: 'alice', splitType: 'shares', shares: 1 },
            { memberId: 'bob', splitType: 'shares', shares: 1 },
            { memberId: 'charlie', splitType: 'shares', shares: 1 },
          ],
        } as ExpenseEntry,
      ];

      const balances = calculateBalances(entries);

      // Total owed should equal total paid (no rounding error)
      const totalOwed = Array.from(balances.values()).reduce((sum, b) => sum + b.totalOwed, 0);
      const totalPaid = Array.from(balances.values()).reduce((sum, b) => sum + b.totalPaid, 0);

      expect(totalOwed).toBe(200);
      expect(totalPaid).toBe(200);

      // Verify individual splits sum to exactly $200
      const alice = balances.get('alice');
      const bob = balances.get('bob');
      const charlie = balances.get('charlie');

      const splitSum = (alice?.totalOwed ?? 0) + (bob?.totalOwed ?? 0) + (charlie?.totalOwed ?? 0);
      expect(splitSum).toBe(200);

      // Splits should be deterministic: sorted by member ID, remainder goes to first members
      // $200 / 3 = 66.666... → alice gets $66.67, bob gets $66.67, charlie gets $66.66
      expect(alice?.totalOwed).toBe(66.67);
      expect(bob?.totalOwed).toBe(66.67);
      expect(charlie?.totalOwed).toBe(66.66);
    });

  describe('getTotalSettlementAmount', () => {
    it('should calculate total settlement amount', () => {
      const plan = {
        transactions: [
          { from: 'A', to: 'B', amount: 50 },
          { from: 'C', to: 'B', amount: 30 },
          { from: 'A', to: 'D', amount: 20 },
        ],
        totalTransactions: 3,
      };

      const total = getTotalSettlementAmount(plan);
      expect(total).toBe(100);
    });
  });

  describe('isBalanceSettled', () => {
    it('should detect settled balance', () => {
      const balance = { memberId: 'member-1', totalPaid: 50, totalOwed: 50, netBalance: 0 };
      expect(isBalanceSettled(balance)).toBe(true);
    });

    it('should detect unsettled balance', () => {
      const balance = { memberId: 'member-1', totalPaid: 50, totalOwed: 40, netBalance: 10 };
      expect(isBalanceSettled(balance)).toBe(false);
    });

    it('should handle rounding tolerance', () => {
      const balance = { memberId: 'member-1', totalPaid: 50, totalOwed: 50.005, netBalance: -0.005 };
      expect(isBalanceSettled(balance)).toBe(true);
    });
  });

  describe('areAllBalancesSettled', () => {
    it('should detect all balances settled', () => {
      const balances = new Map([
        ['member-1', { memberId: 'member-1', totalPaid: 50, totalOwed: 50, netBalance: 0 }],
        ['member-2', { memberId: 'member-2', totalPaid: 50, totalOwed: 50, netBalance: 0 }],
      ]);

      expect(areAllBalancesSettled(balances)).toBe(true);
    });

    it('should detect unsettled balances', () => {
      const balances = new Map([
        ['member-1', { memberId: 'member-1', totalPaid: 50, totalOwed: 50, netBalance: 0 }],
        ['member-2', { memberId: 'member-2', totalPaid: 40, totalOwed: 50, netBalance: -10 }],
      ]);

      expect(areAllBalancesSettled(balances)).toBe(false);
    });
  });
});
