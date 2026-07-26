import { describe, expect, it, vi } from 'vitest';

import { ExclusiveActionGate } from './exclusiveActionGate';

describe('ExclusiveActionGate', () => {
  it('rejects a concurrent action and releases the gate after completion', async () => {
    let releaseFirst!: () => void;
    const firstTask = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const transitions: (string | null)[] = [];
    const gate = new ExclusiveActionGate<string>((action) => transitions.push(action));
    const first = gate.run('first', () => firstTask);
    const secondTask = vi.fn();

    await expect(gate.run('second', secondTask)).resolves.toBe(false);
    expect(secondTask).not.toHaveBeenCalled();
    releaseFirst();
    await expect(first).resolves.toBe(true);
    await expect(gate.run('third', vi.fn())).resolves.toBe(true);
    expect(transitions).toEqual(['first', null, 'third', null]);
  });

  it('releases the gate when an action throws', async () => {
    const gate = new ExclusiveActionGate<string>();

    await expect(gate.run('failing', () => {
      throw new Error('failure');
    })).rejects.toThrow('failure');
    await expect(gate.run('next', vi.fn())).resolves.toBe(true);
  });
});
