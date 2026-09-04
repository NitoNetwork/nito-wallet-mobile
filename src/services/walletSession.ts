export type WalletSessionToken = Readonly<{
  generation: number;
  walletId: string;
}>;

export class WalletSessionGuard {
  private generation = 0;
  private walletId: string | null = null;

  begin(walletId: string): WalletSessionToken {
    this.generation += 1;
    this.walletId = walletId;
    return this.currentToken();
  }

  invalidate(): void {
    this.generation += 1;
    this.walletId = null;
  }

  capture(expectedWalletId?: string): WalletSessionToken | null {
    if (
      this.walletId === null
      || (expectedWalletId !== undefined && expectedWalletId !== this.walletId)
    ) {
      return null;
    }

    return this.currentToken();
  }

  isCurrent(session: WalletSessionToken | null): session is WalletSessionToken {
    return session !== null
      && session.generation === this.generation
      && session.walletId === this.walletId;
  }

  runIfCurrent(session: WalletSessionToken, effect: () => void): boolean {
    if (!this.isCurrent(session)) {
      return false;
    }

    effect();
    return true;
  }

  private currentToken(): WalletSessionToken {
    if (this.walletId === null) {
      throw new Error('No active wallet session.');
    }

    return Object.freeze({
      generation: this.generation,
      walletId: this.walletId,
    });
  }
}
