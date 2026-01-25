/**
 * Member State Tests
 *
 * Tests for the centralized member state computation logic.
 */

import { describe, it, expect } from 'vitest';
import type {
  MemberEvent,
  MemberCreatedEvent,
  MemberRenamedEvent,
  MemberRetiredEvent,
  MemberUnretiredEvent,
  MemberReplacedEvent,
} from '@partage/shared';
import {
  computeMemberState,
  computeAllMemberStates,
  getActiveMembers,
  getRetiredMembers,
  getReplacedMembers,
  resolveCanonicalMemberId,
  resolveRootMemberId,
  buildCanonicalIdMap,
  findAllAliasesFor,
  getMemberDisplayName,
  canRenameMember,
  canRetireMember,
  canUnretireMember,
  canReplaceMember,
  createMemberCreatedEvent,
  createMemberRenamedEvent,
  createMemberRetiredEvent,
  createMemberUnretiredEvent,
  createMemberReplacedEvent,
} from './member-state';

// ==================== Helper Functions ====================

function makeCreatedEvent(
  memberId: string,
  name: string,
  options: { timestamp?: number; isVirtual?: boolean; publicKey?: string } = {}
): MemberCreatedEvent {
  return {
    id: crypto.randomUUID(),
    type: 'member_created',
    memberId,
    name,
    timestamp: options.timestamp ?? Date.now(),
    actorId: 'actor-1',
    isVirtual: options.isVirtual ?? false,
    publicKey: options.publicKey,
  };
}

function makeRenamedEvent(
  memberId: string,
  previousName: string,
  newName: string,
  timestamp?: number
): MemberRenamedEvent {
  return {
    id: crypto.randomUUID(),
    type: 'member_renamed',
    memberId,
    previousName,
    newName,
    timestamp: timestamp ?? Date.now(),
    actorId: 'actor-1',
  };
}

function makeRetiredEvent(memberId: string, timestamp?: number): MemberRetiredEvent {
  return {
    id: crypto.randomUUID(),
    type: 'member_retired',
    memberId,
    timestamp: timestamp ?? Date.now(),
    actorId: 'actor-1',
  };
}

function makeUnretiredEvent(memberId: string, timestamp?: number): MemberUnretiredEvent {
  return {
    id: crypto.randomUUID(),
    type: 'member_unretired',
    memberId,
    timestamp: timestamp ?? Date.now(),
    actorId: 'actor-1',
  };
}

function makeReplacedEvent(
  memberId: string,
  replacedById: string,
  timestamp?: number
): MemberReplacedEvent {
  return {
    id: crypto.randomUUID(),
    type: 'member_replaced',
    memberId,
    replacedById,
    timestamp: timestamp ?? Date.now(),
    actorId: 'actor-1',
  };
}

// ==================== Tests ====================

describe('computeMemberState', () => {
  it('returns null for non-existent member', () => {
    const events: MemberEvent[] = [];
    expect(computeMemberState('member-1', events)).toBeNull();
  });

  it('computes initial state from creation event', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Alice', { isVirtual: false, publicKey: 'pk123' }),
    ];

    const state = computeMemberState('member-1', events);
    expect(state).not.toBeNull();
    expect(state!.id).toBe('member-1');
    expect(state!.name).toBe('Alice');
    expect(state!.publicKey).toBe('pk123');
    expect(state!.isVirtual).toBe(false);
    expect(state!.isRetired).toBe(false);
    expect(state!.isReplaced).toBe(false);
    expect(state!.isActive).toBe(true);
  });

  it('computes state for virtual member', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Bob (virtual)', { isVirtual: true }),
    ];

    const state = computeMemberState('member-1', events);
    expect(state!.isVirtual).toBe(true);
    expect(state!.publicKey).toBeUndefined();
  });

  it('applies rename event', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Alice', { timestamp: 1000 }),
      makeRenamedEvent('member-1', 'Alice', 'Alice Smith', 2000),
    ];

    const state = computeMemberState('member-1', events);
    expect(state!.name).toBe('Alice Smith');
  });

  it('applies multiple rename events in order', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Alice', { timestamp: 1000 }),
      makeRenamedEvent('member-1', 'Alice', 'Alice Smith', 2000),
      makeRenamedEvent('member-1', 'Alice Smith', 'Alice Jones', 3000),
    ];

    const state = computeMemberState('member-1', events);
    expect(state!.name).toBe('Alice Jones');
  });

  it('applies retire event', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Alice', { timestamp: 1000 }),
      makeRetiredEvent('member-1', 2000),
    ];

    const state = computeMemberState('member-1', events);
    expect(state!.isRetired).toBe(true);
    expect(state!.retiredAt).toBe(2000);
    expect(state!.isActive).toBe(false);
  });

  it('applies unretire event after retire', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Alice', { timestamp: 1000 }),
      makeRetiredEvent('member-1', 2000),
      makeUnretiredEvent('member-1', 3000),
    ];

    const state = computeMemberState('member-1', events);
    expect(state!.isRetired).toBe(false);
    expect(state!.retiredAt).toBeUndefined();
    expect(state!.isActive).toBe(true);
  });

  it('applies replaced event', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Bob (virtual)', { timestamp: 1000, isVirtual: true }),
      makeCreatedEvent('member-2', 'Bob', { timestamp: 1500, isVirtual: false }),
      makeReplacedEvent('member-1', 'member-2', 2000),
    ];

    const state = computeMemberState('member-1', events);
    expect(state!.isReplaced).toBe(true);
    expect(state!.replacedById).toBe('member-2');
    expect(state!.replacedAt).toBe(2000);
    expect(state!.isActive).toBe(false);
  });

  it('ignores retire event on already retired member', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Alice', { timestamp: 1000 }),
      makeRetiredEvent('member-1', 2000),
      makeRetiredEvent('member-1', 3000), // Should be ignored
    ];

    const state = computeMemberState('member-1', events);
    expect(state!.isRetired).toBe(true);
    expect(state!.retiredAt).toBe(2000); // Original timestamp
  });

  it('ignores unretire event on non-retired member', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Alice', { timestamp: 1000 }),
      makeUnretiredEvent('member-1', 2000), // Should be ignored
    ];

    const state = computeMemberState('member-1', events);
    expect(state!.isRetired).toBe(false);
    expect(state!.isActive).toBe(true);
  });

  it('ignores retire event on replaced member', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Bob (virtual)', { timestamp: 1000, isVirtual: true }),
      makeCreatedEvent('member-2', 'Bob', { timestamp: 1500, isVirtual: false }),
      makeReplacedEvent('member-1', 'member-2', 2000),
      makeRetiredEvent('member-1', 3000), // Should be ignored - already replaced
    ];

    const state = computeMemberState('member-1', events);
    expect(state!.isReplaced).toBe(true);
    expect(state!.isRetired).toBe(false); // Retire was ignored
  });

  it('ignores replace event on retired member', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Alice', { timestamp: 1000 }),
      makeCreatedEvent('member-2', 'Alice New', { timestamp: 1500 }),
      makeRetiredEvent('member-1', 2000),
      makeReplacedEvent('member-1', 'member-2', 3000), // Should be ignored - already retired
    ];

    const state = computeMemberState('member-1', events);
    expect(state!.isRetired).toBe(true);
    expect(state!.isReplaced).toBe(false); // Replace was ignored
  });

  it('ignores replace event on already replaced member', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Bob (virtual)', { timestamp: 1000, isVirtual: true }),
      makeCreatedEvent('member-2', 'Bob', { timestamp: 1500, isVirtual: false }),
      makeCreatedEvent('member-3', 'Bob V2', { timestamp: 1600, isVirtual: false }),
      makeReplacedEvent('member-1', 'member-2', 2000),
      makeReplacedEvent('member-1', 'member-3', 3000), // Should be ignored - already replaced
    ];

    const state = computeMemberState('member-1', events);
    expect(state!.replacedById).toBe('member-2'); // Original replacement
  });

  it('allows rename on retired member', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Alice', { timestamp: 1000 }),
      makeRetiredEvent('member-1', 2000),
      makeRenamedEvent('member-1', 'Alice', 'Alice Smith', 3000),
    ];

    const state = computeMemberState('member-1', events);
    expect(state!.name).toBe('Alice Smith');
    expect(state!.isRetired).toBe(true);
  });

  it('allows rename on replaced member', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Bob (virtual)', { timestamp: 1000, isVirtual: true }),
      makeCreatedEvent('member-2', 'Bob', { timestamp: 1500, isVirtual: false }),
      makeReplacedEvent('member-1', 'member-2', 2000),
      makeRenamedEvent('member-1', 'Bob (virtual)', 'Robert (virtual)', 3000),
    ];

    const state = computeMemberState('member-1', events);
    expect(state!.name).toBe('Robert (virtual)');
    expect(state!.isReplaced).toBe(true);
  });

  it('handles events out of order by sorting by timestamp', () => {
    const events: MemberEvent[] = [
      makeRenamedEvent('member-1', 'Alice', 'Alice Smith', 2000),
      makeCreatedEvent('member-1', 'Alice', { timestamp: 1000 }),
    ];

    const state = computeMemberState('member-1', events);
    expect(state!.name).toBe('Alice Smith');
  });
});

describe('computeAllMemberStates', () => {
  it('computes states for all members', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Alice', { timestamp: 1000 }),
      makeCreatedEvent('member-2', 'Bob', { timestamp: 1100 }),
      makeCreatedEvent('member-3', 'Carol', { timestamp: 1200 }),
    ];

    const states = computeAllMemberStates(events);
    expect(states.size).toBe(3);
    expect(states.get('member-1')!.name).toBe('Alice');
    expect(states.get('member-2')!.name).toBe('Bob');
    expect(states.get('member-3')!.name).toBe('Carol');
  });
});

describe('getActiveMembers / getRetiredMembers / getReplacedMembers', () => {
  it('filters members by status', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Alice', { timestamp: 1000 }),
      makeCreatedEvent('member-2', 'Bob', { timestamp: 1100 }),
      makeCreatedEvent('member-3', 'Carol (virtual)', { timestamp: 1200, isVirtual: true }),
      makeCreatedEvent('member-4', 'Carol', { timestamp: 1300, isVirtual: false }),
      makeRetiredEvent('member-2', 2000),
      makeReplacedEvent('member-3', 'member-4', 2100),
    ];

    const active = getActiveMembers(events);
    const retired = getRetiredMembers(events);
    const replaced = getReplacedMembers(events);

    expect(active.length).toBe(2);
    expect(active.map((m) => m.id).sort()).toEqual(['member-1', 'member-4']);

    expect(retired.length).toBe(1);
    expect(retired[0]?.id).toBe('member-2');

    expect(replaced.length).toBe(1);
    expect(replaced[0]?.id).toBe('member-3');
  });
});

describe('resolveCanonicalMemberId', () => {
  it('returns same ID for non-replaced member', () => {
    const events: MemberEvent[] = [makeCreatedEvent('member-1', 'Alice', { timestamp: 1000 })];

    const canonical = resolveCanonicalMemberId('member-1', events);
    expect(canonical).toBe('member-1');
  });

  it('resolves to replacer for replaced member', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Bob (virtual)', { timestamp: 1000, isVirtual: true }),
      makeCreatedEvent('member-2', 'Bob', { timestamp: 1100 }),
      makeReplacedEvent('member-1', 'member-2', 2000),
    ];

    const canonical = resolveCanonicalMemberId('member-1', events);
    expect(canonical).toBe('member-2');
  });

  it('resolves recursively through replacement chain', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Bob (v1)', { timestamp: 1000, isVirtual: true }),
      makeCreatedEvent('member-2', 'Bob (v2)', { timestamp: 1100, isVirtual: true }),
      makeCreatedEvent('member-3', 'Bob', { timestamp: 1200, isVirtual: false }),
      makeReplacedEvent('member-1', 'member-2', 2000),
      makeReplacedEvent('member-2', 'member-3', 3000),
    ];

    // member-1 -> member-2 -> member-3
    expect(resolveCanonicalMemberId('member-1', events)).toBe('member-3');
    expect(resolveCanonicalMemberId('member-2', events)).toBe('member-3');
    expect(resolveCanonicalMemberId('member-3', events)).toBe('member-3');
  });

  it('returns input ID for unknown member', () => {
    const events: MemberEvent[] = [];
    const canonical = resolveCanonicalMemberId('unknown', events);
    expect(canonical).toBe('unknown');
  });

  it('handles max depth protection', () => {
    // Create a long chain
    const events: MemberEvent[] = [];
    for (let i = 0; i < 20; i++) {
      events.push(makeCreatedEvent(`member-${i}`, `Member ${i}`, { timestamp: 1000 + i }));
      if (i > 0) {
        events.push(makeReplacedEvent(`member-${i - 1}`, `member-${i}`, 2000 + i));
      }
    }

    // With default maxDepth of 10, should not resolve all the way
    const canonical = resolveCanonicalMemberId('member-0', events, 10);
    // Should stop at depth 10
    expect(canonical).not.toBe('member-0'); // Did resolve some
  });
});

describe('resolveRootMemberId', () => {
  it('returns same ID for non-replaced member', () => {
    const events: MemberEvent[] = [makeCreatedEvent('member-1', 'Alice', { timestamp: 1000 })];

    const root = resolveRootMemberId('member-1', events);
    expect(root).toBe('member-1');
  });

  it('resolves to original member when replaced', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Bob (virtual)', { timestamp: 1000, isVirtual: true }),
      makeCreatedEvent('member-2', 'Bob', { timestamp: 1100 }),
      makeReplacedEvent('member-1', 'member-2', 2000),
    ];

    // member-2 replaced member-1, so root of member-2 is member-1
    const root = resolveRootMemberId('member-2', events);
    expect(root).toBe('member-1');

    // member-1 is the root itself
    expect(resolveRootMemberId('member-1', events)).toBe('member-1');
  });

  it('resolves recursively through replacement chain backwards', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Bob (v1)', { timestamp: 1000, isVirtual: true }),
      makeCreatedEvent('member-2', 'Bob (v2)', { timestamp: 1100, isVirtual: true }),
      makeCreatedEvent('member-3', 'Bob', { timestamp: 1200, isVirtual: false }),
      makeReplacedEvent('member-1', 'member-2', 2000),
      makeReplacedEvent('member-2', 'member-3', 3000),
    ];

    // Chain: member-1 -> member-2 -> member-3
    // Root of any member in this chain should be member-1
    expect(resolveRootMemberId('member-3', events)).toBe('member-1');
    expect(resolveRootMemberId('member-2', events)).toBe('member-1');
    expect(resolveRootMemberId('member-1', events)).toBe('member-1');
  });

  it('returns input ID for unknown member', () => {
    const events: MemberEvent[] = [];
    const root = resolveRootMemberId('unknown', events);
    expect(root).toBe('unknown');
  });

  it('handles max depth protection', () => {
    // Create a long chain
    const events: MemberEvent[] = [];
    for (let i = 0; i < 20; i++) {
      events.push(makeCreatedEvent(`member-${i}`, `Member ${i}`, { timestamp: 1000 + i }));
      if (i > 0) {
        events.push(makeReplacedEvent(`member-${i - 1}`, `member-${i}`, 2000 + i));
      }
    }

    // With maxDepth of 10, resolving member-19 backwards should stop at some point
    const root = resolveRootMemberId('member-19', events, 10);
    // Should have resolved backwards but hit the depth limit
    expect(root).not.toBe('member-19'); // Did resolve some
    expect(root).not.toBe('member-0'); // But didn't reach the root
  });

  it('works correctly with canonical ID (opposite directions)', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Alice (virtual)', { timestamp: 1000, isVirtual: true }),
      makeCreatedEvent('member-2', 'Alice', { timestamp: 1100 }),
      makeReplacedEvent('member-1', 'member-2', 2000),
    ];

    // Canonical ID goes forward: member-1 -> member-2 (newest)
    expect(resolveCanonicalMemberId('member-1', events)).toBe('member-2');

    // Root ID goes backward: member-2 -> member-1 (oldest)
    expect(resolveRootMemberId('member-2', events)).toBe('member-1');
  });
});

describe('buildCanonicalIdMap', () => {
  it('builds map of all canonical ID resolutions', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Bob (virtual)', { timestamp: 1000, isVirtual: true }),
      makeCreatedEvent('member-2', 'Bob', { timestamp: 1100 }),
      makeCreatedEvent('member-3', 'Alice', { timestamp: 1200 }),
      makeReplacedEvent('member-1', 'member-2', 2000),
    ];

    const map = buildCanonicalIdMap(events);
    expect(map.get('member-1')).toBe('member-2');
    expect(map.get('member-2')).toBe('member-2');
    expect(map.get('member-3')).toBe('member-3');
  });
});

describe('findAllAliasesFor', () => {
  it('finds all member IDs that resolve to canonical ID', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Bob (v1)', { timestamp: 1000, isVirtual: true }),
      makeCreatedEvent('member-2', 'Bob (v2)', { timestamp: 1100, isVirtual: true }),
      makeCreatedEvent('member-3', 'Bob', { timestamp: 1200, isVirtual: false }),
      makeReplacedEvent('member-1', 'member-2', 2000),
      makeReplacedEvent('member-2', 'member-3', 3000),
    ];

    const aliases = findAllAliasesFor('member-3', events);
    expect(aliases.sort()).toEqual(['member-1', 'member-2', 'member-3']);
  });
});

describe('getMemberDisplayName', () => {
  it('returns name of canonical member', () => {
    const events: MemberEvent[] = [
      makeCreatedEvent('member-1', 'Bob (virtual)', { timestamp: 1000, isVirtual: true }),
      makeCreatedEvent('member-2', 'Bob Real', { timestamp: 1100 }),
      makeReplacedEvent('member-1', 'member-2', 2000),
    ];

    // Looking up replaced member shows canonical member's name
    expect(getMemberDisplayName('member-1', events)).toBe('Bob Real');
    expect(getMemberDisplayName('member-2', events)).toBe('Bob Real');
  });
});

describe('Validation functions', () => {
  describe('canRenameMember', () => {
    it('allows rename on any existing member', () => {
      const events: MemberEvent[] = [makeCreatedEvent('member-1', 'Alice', { timestamp: 1000 })];

      expect(canRenameMember('member-1', events)).toEqual({ valid: true });
    });

    it('rejects rename on non-existent member', () => {
      const events: MemberEvent[] = [];
      const result = canRenameMember('member-1', events);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Member does not exist');
    });
  });

  describe('canRetireMember', () => {
    it('allows retire on active member', () => {
      const events: MemberEvent[] = [makeCreatedEvent('member-1', 'Alice', { timestamp: 1000 })];

      expect(canRetireMember('member-1', events)).toEqual({ valid: true });
    });

    it('rejects retire on already retired member', () => {
      const events: MemberEvent[] = [
        makeCreatedEvent('member-1', 'Alice', { timestamp: 1000 }),
        makeRetiredEvent('member-1', 2000),
      ];

      const result = canRetireMember('member-1', events);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Member is already retired');
    });

    it('rejects retire on replaced member', () => {
      const events: MemberEvent[] = [
        makeCreatedEvent('member-1', 'Bob (virtual)', { timestamp: 1000, isVirtual: true }),
        makeCreatedEvent('member-2', 'Bob', { timestamp: 1100 }),
        makeReplacedEvent('member-1', 'member-2', 2000),
      ];

      const result = canRetireMember('member-1', events);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Member has been replaced by another member');
    });
  });

  describe('canUnretireMember', () => {
    it('allows unretire on retired member', () => {
      const events: MemberEvent[] = [
        makeCreatedEvent('member-1', 'Alice', { timestamp: 1000 }),
        makeRetiredEvent('member-1', 2000),
      ];

      expect(canUnretireMember('member-1', events)).toEqual({ valid: true });
    });

    it('rejects unretire on non-retired member', () => {
      const events: MemberEvent[] = [makeCreatedEvent('member-1', 'Alice', { timestamp: 1000 })];

      const result = canUnretireMember('member-1', events);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Member is not retired');
    });
  });

  describe('canReplaceMember', () => {
    it('allows replace on active member', () => {
      const events: MemberEvent[] = [
        makeCreatedEvent('member-1', 'Bob (virtual)', { timestamp: 1000, isVirtual: true }),
        makeCreatedEvent('member-2', 'Bob', { timestamp: 1100 }),
      ];

      expect(canReplaceMember('member-1', 'member-2', events)).toEqual({ valid: true });
    });

    it('rejects replace on retired member', () => {
      const events: MemberEvent[] = [
        makeCreatedEvent('member-1', 'Alice', { timestamp: 1000 }),
        makeCreatedEvent('member-2', 'Alice New', { timestamp: 1100 }),
        makeRetiredEvent('member-1', 2000),
      ];

      const result = canReplaceMember('member-1', 'member-2', events);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Cannot replace a retired member');
    });

    it('rejects replace on already replaced member', () => {
      const events: MemberEvent[] = [
        makeCreatedEvent('member-1', 'Bob (virtual)', { timestamp: 1000, isVirtual: true }),
        makeCreatedEvent('member-2', 'Bob', { timestamp: 1100 }),
        makeCreatedEvent('member-3', 'Bob V2', { timestamp: 1200 }),
        makeReplacedEvent('member-1', 'member-2', 2000),
      ];

      const result = canReplaceMember('member-1', 'member-3', events);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Member has already been replaced');
    });

    it('rejects replace with self', () => {
      const events: MemberEvent[] = [makeCreatedEvent('member-1', 'Alice', { timestamp: 1000 })];

      const result = canReplaceMember('member-1', 'member-1', events);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Cannot replace member with themselves');
    });
  });
});

describe('Event creation helpers', () => {
  it('creates member created event', () => {
    const event = createMemberCreatedEvent('member-1', 'Alice', 'actor-1', {
      isVirtual: false,
      publicKey: 'pk123',
    });

    expect(event.type).toBe('member_created');
    expect(event.memberId).toBe('member-1');
    expect(event.name).toBe('Alice');
    expect(event.actorId).toBe('actor-1');
    expect(event.isVirtual).toBe(false);
    expect(event.publicKey).toBe('pk123');
    expect(event.id).toBeDefined();
    expect(event.timestamp).toBeGreaterThan(0);
  });

  it('creates member renamed event', () => {
    const event = createMemberRenamedEvent('member-1', 'Alice', 'Alice Smith', 'actor-1');

    expect(event.type).toBe('member_renamed');
    expect(event.memberId).toBe('member-1');
    expect(event.previousName).toBe('Alice');
    expect(event.newName).toBe('Alice Smith');
  });

  it('creates member retired event', () => {
    const event = createMemberRetiredEvent('member-1', 'actor-1');

    expect(event.type).toBe('member_retired');
    expect(event.memberId).toBe('member-1');
  });

  it('creates member unretired event', () => {
    const event = createMemberUnretiredEvent('member-1', 'actor-1');

    expect(event.type).toBe('member_unretired');
    expect(event.memberId).toBe('member-1');
  });

  it('creates member replaced event', () => {
    const event = createMemberReplacedEvent('member-1', 'member-2', 'actor-1');

    expect(event.type).toBe('member_replaced');
    expect(event.memberId).toBe('member-1');
    expect(event.replacedById).toBe('member-2');
  });
});
