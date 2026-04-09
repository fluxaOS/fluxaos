import { describe, expect, it } from 'vitest';
import type { IssueState } from '@/core/issues/types';
import { VALID_TRANSITIONS } from '@/core/issues/types';

describe('issue lifecycle E2E', () => {
  describe('happy path: open → in_progress → closed', () => {
    it('open → in_progress is valid', () => {
      expect(VALID_TRANSITIONS.open).toContain('in_progress');
    });

    it('in_progress → closed is valid', () => {
      expect(VALID_TRANSITIONS.in_progress).toContain('closed');
    });

    it('full lifecycle chain validates', () => {
      const path: IssueState[] = ['open', 'in_progress', 'closed'];
      for (let i = 0; i < path.length - 1; i++) {
        expect(VALID_TRANSITIONS[path[i]]).toContain(path[i + 1]);
      }
    });
  });

  describe('block/unblock cycle', () => {
    it('in_progress → blocked → in_progress round-trip', () => {
      expect(VALID_TRANSITIONS.in_progress).toContain('blocked');
      expect(VALID_TRANSITIONS.blocked).toContain('in_progress');
    });

    it('open → blocked → open round-trip', () => {
      expect(VALID_TRANSITIONS.open).toContain('blocked');
      expect(VALID_TRANSITIONS.blocked).toContain('open');
    });

    it('blocked cannot transition directly to closed', () => {
      expect(VALID_TRANSITIONS.blocked).not.toContain('closed');
    });
  });

  describe('reopen from closed', () => {
    it('closed → open is valid', () => {
      expect(VALID_TRANSITIONS.closed).toContain('open');
    });

    it('closed cannot go directly to in_progress', () => {
      expect(VALID_TRANSITIONS.closed).not.toContain('in_progress');
    });

    it('closed cannot go directly to blocked', () => {
      expect(VALID_TRANSITIONS.closed).not.toContain('blocked');
    });

    it('full reopen cycle: open → closed → open → in_progress → closed', () => {
      const path: IssueState[] = [
        'open',
        'closed',
        'open',
        'in_progress',
        'closed',
      ];
      for (let i = 0; i < path.length - 1; i++) {
        expect(VALID_TRANSITIONS[path[i]]).toContain(path[i + 1]);
      }
    });
  });

  describe('invalid transitions', () => {
    it('open → open is not valid (no self-transitions)', () => {
      expect(VALID_TRANSITIONS.open).not.toContain('open');
    });

    it('closed → blocked is not valid', () => {
      expect(VALID_TRANSITIONS.closed).not.toContain('blocked');
    });

    it('closed → in_progress is not valid (must reopen first)', () => {
      expect(VALID_TRANSITIONS.closed).not.toContain('in_progress');
    });
  });

  describe('state machine completeness', () => {
    const allStates: IssueState[] = [
      'open',
      'in_progress',
      'blocked',
      'closed',
    ];

    it('every state has at least one valid transition', () => {
      for (const state of allStates) {
        expect(VALID_TRANSITIONS[state].length).toBeGreaterThan(0);
      }
    });

    it('every target state exists as a key', () => {
      for (const targets of Object.values(VALID_TRANSITIONS)) {
        for (const target of targets) {
          expect(VALID_TRANSITIONS).toHaveProperty(target);
        }
      }
    });

    it('every state is reachable from open', () => {
      const visited = new Set<IssueState>(['open']);
      const queue: IssueState[] = ['open'];

      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const next of VALID_TRANSITIONS[current]) {
          if (!visited.has(next)) {
            visited.add(next);
            queue.push(next);
          }
        }
      }

      for (const state of allStates) {
        expect(visited.has(state)).toBe(true);
      }
    });

    it('no self-transitions exist', () => {
      for (const state of allStates) {
        expect(VALID_TRANSITIONS[state]).not.toContain(state);
      }
    });
  });
});
