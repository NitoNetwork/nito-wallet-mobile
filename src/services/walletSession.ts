export type WalletSessionToken = Readonly<{
  generation: number;
  walletAddress: string;
}>;

export class WalletSessionGuard {
  private generation = 0;
  private walletAddress: string | null = null;

  begin(walletAddress: string): WalletSessionToken {
    this.generation += 1;
    this.walletAddress = walletAddress;
    return this.currentToken();
  }

  invalidate(): void {
    this.generation += 1;
    this.walletAddress = null;
  }

  capture(expectedWalletAddress?: string): WalletSessionToken | null {
    if (
      this.walletAddress === null
      || (expectedWalletAddress !== undefined && expectedWalletAddress !== this.walletAddress)
    ) {
      return null;
    }

    return this.currentToken();
  }

  isCurrent(session: WalletSessionToken | null): session is WalletSessionToken {
    return session !== null
      && session.generation === this.generation
      && session.walletAddress === this.walletAddress;
  }

  runIfCurrent(session: WalletSessionToken, effect: () => void): boolean {
    if (!this.isCurrent(session)) {
      return false;
    }

    effect();
    return true;
  }

  private currentToken(): WalletSessionToken {
    if (this.walletAddress === null) {
      throw new Error('No active wallet session.');
    }

    return Object.freeze({
      generation: this.generation,
      walletAddress: this.walletAddress,
    });
  }
}
