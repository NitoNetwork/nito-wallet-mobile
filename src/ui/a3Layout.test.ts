import { describe, expect, it } from 'vitest';

import appSource from '../../App.tsx?raw';
import screensSource from './screens.tsx?raw';
import tabsSource from './tabs.tsx?raw';

describe('A3 compact wallet shell', () => {
  it('mounts one fixed background selected from the current session state', () => {
    expect(appSource.match(/<WalletBackground/g)).toHaveLength(1);
    expect(appSource).toContain("variant={screen === 'wallet' ? 'wallet' : 'auth'}");
  });

  it('keeps the five wallet tabs in their established order', () => {
    const expectedOrder = ['home', 'receive', 'send', 'history', 'security'];
    const positions = expectedOrder.map((key) => appSource.indexOf(`key: '${key}'`));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it('renders active content before the fixed bottom navigation', () => {
    const shellStart = screensSource.indexOf('export function WalletShell');
    const shellSource = screensSource.slice(shellStart);

    expect(shellSource.indexOf('{children}')).toBeLessThan(shellSource.indexOf('<View style={styles.tabs}>'));
    expect(shellSource).toContain('accessibilityRole="tab"');
    expect(shellSource).toContain('accessibilityState={{ selected: activeTab === tab.key }}');
  });

  it('shows only values already provided by the network snapshot on Home', () => {
    const homeStart = tabsSource.indexOf('export function HomeTab');
    const homeSource = tabsSource.slice(homeStart);

    expect(homeSource).toContain('network.snapshot.spendableSats');
    expect(homeSource).toContain('network.snapshot.confirmedSats');
    expect(homeSource).toContain('network.snapshot.unconfirmedSats');
    expect(homeSource).toContain('network.snapshot?.history[0]');
    expect(homeSource).toContain('eligibleUtxos.length >= CONSOLIDATION_MIN_UTXOS');
  });
});
