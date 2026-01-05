/**
 * Balance calculation engine
 *
 * Calculates balances, debt graphs, and optimized settlement plans
 * from a list of entries (expenses and transfers).
 */
/**
 * Calculate balances for all members in a group
 */
export function calculateBalances(entries) {
    const balances = new Map();
    // Initialize balances for all members
    const allMemberIds = new Set();
    for (const entry of entries) {
        if (entry.status !== 'active')
            continue;
        if (entry.type === 'expense') {
            const expense = entry;
            expense.payers.forEach((p) => allMemberIds.add(p.memberId));
            expense.beneficiaries.forEach((b) => allMemberIds.add(b.memberId));
        }
        else {
            const transfer = entry;
            allMemberIds.add(transfer.from);
            allMemberIds.add(transfer.to);
        }
    }
    allMemberIds.forEach((memberId) => {
        balances.set(memberId, {
            memberId,
            totalPaid: 0,
            totalOwed: 0,
            netBalance: 0,
        });
    });
    // Process each entry
    for (const entry of entries) {
        if (entry.status !== 'active')
            continue;
        const amount = entry.defaultCurrencyAmount ?? entry.amount;
        if (entry.type === 'expense') {
            processExpense(entry, amount, balances);
        }
        else {
            processTransfer(entry, amount, balances);
        }
    }
    // Calculate net balances
    balances.forEach((balance) => {
        balance.netBalance = balance.totalPaid - balance.totalOwed;
    });
    return balances;
}
/**
 * Process an expense entry
 */
function processExpense(expense, totalAmount, balances) {
    // Record who paid
    for (const payer of expense.payers) {
        const balance = balances.get(payer.memberId);
        const payerAmount = expense.defaultCurrencyAmount
            ? payer.amount * (expense.defaultCurrencyAmount / expense.amount)
            : payer.amount;
        balance.totalPaid += payerAmount;
    }
    // Calculate split amounts
    const splits = calculateSplits(expense.beneficiaries, totalAmount);
    // Record who owes
    for (const [memberId, amount] of splits.entries()) {
        const balance = balances.get(memberId);
        balance.totalOwed += amount;
    }
}
/**
 * Calculate split amounts based on beneficiaries
 */
function calculateSplits(beneficiaries, totalAmount) {
    const splits = new Map();
    // Separate by split type
    const sharesBeneficiaries = beneficiaries.filter((b) => b.splitType === 'shares');
    const exactBeneficiaries = beneficiaries.filter((b) => b.splitType === 'exact');
    // Calculate exact amounts first
    let exactTotal = 0;
    for (const beneficiary of exactBeneficiaries) {
        const amount = beneficiary.amount ?? 0;
        splits.set(beneficiary.memberId, amount);
        exactTotal += amount;
    }
    // Calculate shares from remaining amount
    if (sharesBeneficiaries.length > 0) {
        const remainingAmount = totalAmount - exactTotal;
        const totalShares = sharesBeneficiaries.reduce((sum, b) => sum + (b.shares ?? 1), 0);
        for (const beneficiary of sharesBeneficiaries) {
            const shares = beneficiary.shares ?? 1;
            const amount = (shares / totalShares) * remainingAmount;
            splits.set(beneficiary.memberId, amount);
        }
    }
    return splits;
}
/**
 * Process a transfer entry
 */
function processTransfer(transfer, amount, balances) {
    const fromBalance = balances.get(transfer.from);
    const toBalance = balances.get(transfer.to);
    // Transfer sender paid
    fromBalance.totalPaid += amount;
    // Transfer receiver owes
    toBalance.totalOwed += amount;
}
/**
 * Build a debt graph from balances
 * Returns edges representing who owes whom
 */
export function buildDebtGraph(balances) {
    const edges = [];
    // Separate creditors (owed money) and debtors (owe money)
    const creditors = [];
    const debtors = [];
    balances.forEach((balance) => {
        if (balance.netBalance > 0.01) {
            // Owed money (positive balance)
            creditors.push({ memberId: balance.memberId, amount: balance.netBalance });
        }
        else if (balance.netBalance < -0.01) {
            // Owes money (negative balance)
            debtors.push({ memberId: balance.memberId, amount: -balance.netBalance });
        }
    });
    // Sort for consistent results
    creditors.sort((a, b) => b.amount - a.amount);
    debtors.sort((a, b) => b.amount - a.amount);
    // Use greedy algorithm to match debtors to creditors
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
        const debtor = debtors[i];
        const creditor = creditors[j];
        const amount = Math.min(debtor.amount, creditor.amount);
        edges.push({
            from: debtor.memberId,
            to: creditor.memberId,
            amount: Math.round(amount * 100) / 100, // Round to 2 decimals
        });
        debtor.amount -= amount;
        creditor.amount -= amount;
        if (debtor.amount < 0.01)
            i++;
        if (creditor.amount < 0.01)
            j++;
    }
    return edges;
}
/**
 * Generate an optimized settlement plan
 * Uses a greedy algorithm to minimize number of transactions
 */
export function generateSettlementPlan(balances, constraints = []) {
    const debtGraph = buildDebtGraph(balances);
    // Apply constraints (simplified - could be more sophisticated)
    const filteredEdges = applyConstraints(debtGraph, constraints);
    return {
        transactions: filteredEdges,
        totalTransactions: filteredEdges.length,
    };
}
/**
 * Apply settlement constraints to debt graph
 */
function applyConstraints(edges, constraints) {
    let result = [...edges];
    for (const constraint of constraints) {
        if (constraint.type === 'must-not') {
            // Remove edges matching the constraint
            result = result.filter((edge) => !(edge.from === constraint.from && edge.to === constraint.to));
        }
        // 'must' and 'prefer' constraints would require more complex logic
        // to redistribute debt, which we can implement later if needed
    }
    return result;
}
/**
 * Get the total amount settled in a settlement plan
 */
export function getTotalSettlementAmount(plan) {
    return plan.transactions.reduce((sum, edge) => sum + edge.amount, 0);
}
/**
 * Check if all balances are settled (within rounding tolerance)
 */
export function isBalanceSettled(balance) {
    return Math.abs(balance.netBalance) < 0.01;
}
/**
 * Check if all balances in a group are settled
 */
export function areAllBalancesSettled(balances) {
    return Array.from(balances.values()).every(isBalanceSettled);
}
