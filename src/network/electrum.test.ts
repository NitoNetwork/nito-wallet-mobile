import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addressToElectrumScripthash,
  ElectrumInvalidResponseError,
  electrumScripthashFromScript,
  NitoElectrumClient,
  scriptPubKeyForNitoAddress,
} from './electrum';
import { createNitoWalletCryptoTestDouble } from '../test/nitoWalletCryptoTestDouble';
import { scanTransparentWallet } from '../wallet/transparentScan';

const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

describe('Nito Electrum helpers', () => {
  const address = 'nito1qcr8te4kr609gcawutmrza0j4xv80jy8z540c02';

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('builds the P2WPKH scriptPubKey expected by ElectrumX', () => {
    const script = scriptPubKeyForNitoAddress(address);
    expect(toHex(script)).toBe('0014c0cebcd6c3d3ca8c75dc5ec62ebe55330ef910e2');
  });

  it('marks only validated network history as observed for transaction tracking', async () => {
    const client = new NitoElectrumClient();
    vi.spyOn(client, 'request').mockResolvedValue([
      { tx_hash: 'ab'.repeat(32), height: 0 },
    ]);
    await expect(client.getAddressHistory(address)).resolves.toEqual([
      { txid: 'ab'.repeat(32), height: 0, address, networkObserved: true },
    ]);
    vi.mocked(client.request).mockRejectedValueOnce(new Error('offline'));
    await expect(client.getAddressHistory(address)).rejects.toThrow('offline');
  });

  it('uses reversed sha256(scriptPubKey) for Electrum scripthash', () => {
    const script = scriptPubKeyForNitoAddress(address);
    expect(electrumScripthashFromScript(script)).toBe('6e4f16236139f15046b38f399a683fb2aa8edf5fd128b3e5db017fb0ac74078a');
    expect(addressToElectrumScripthash(address)).toBe('6e4f16236139f15046b38f399a683fb2aa8edf5fd128b3e5db017fb0ac74078a');
  });

  it('notifies listeners for advances, lower reorg heights and same-height header changes', () => {
    const client = new NitoElectrumClient();
    client.blockHeight = 100;
    const updates: [number, number][] = [];
    const unsubscribe = client.subscribeBlockHeight((height, previous) => updates.push([height, previous]));
    const handleMessage = (client as unknown as { handleMessage(raw: string): void }).handleMessage.bind(client);

    handleMessage(JSON.stringify({
      method: 'blockchain.headers.subscribe',
      params: [{ height: 100, hex: 'aa' }],
    }));
    handleMessage(JSON.stringify({
      method: 'blockchain.headers.subscribe',
      params: [{ height: 101, hex: 'bb' }],
    }));
    handleMessage(JSON.stringify({
      method: 'blockchain.headers.subscribe',
      params: [{ height: 101, hex: 'cc' }],
    }));
    handleMessage(JSON.stringify({
      method: 'blockchain.headers.subscribe',
      params: [{ height: 99, hex: 'dd' }],
    }));
    unsubscribe();
    handleMessage(JSON.stringify({ method: 'blockchain.headers.subscribe', params: [{ height: 102 }] }));

    expect(updates).toEqual([[101, 100], [101, 101], [99, 101]]);
  });

  it('rejects malformed financial RPC responses instead of converting them to values', async () => {
    const client = new NitoElectrumClient();
    vi.spyOn(client, 'request').mockResolvedValue({ confirmed: '100', unconfirmed: 0 });

    await expect(client.getAddressBalance(address)).rejects.toBeInstanceOf(
      ElectrumInvalidResponseError,
    );

    vi.mocked(client.request).mockResolvedValueOnce([
      { tx_hash: 'not-a-txid', tx_pos: 0, value: 1, height: 1 },
    ]);
    await expect(client.getAddressUtxos(address)).rejects.toBeInstanceOf(
      ElectrumInvalidResponseError,
    );

    vi.mocked(client.request).mockResolvedValueOnce([
      { tx_hash: 'ab'.repeat(32), height: Number.NaN },
    ]);
    await expect(client.getAddressHistory(address)).rejects.toBeInstanceOf(
      ElectrumInvalidResponseError,
    );

    vi.mocked(client.request).mockResolvedValueOnce('not-transaction-hex');
    await expect(client.getTransactionHex('ab'.repeat(32))).rejects.toBeInstanceOf(
      ElectrumInvalidResponseError,
    );

    vi.mocked(client.request).mockResolvedValueOnce('00'.repeat(800_000));
    await expect(client.getTransactionHex('ab'.repeat(32))).resolves.toHaveLength(1_600_000);

    vi.mocked(client.request).mockResolvedValueOnce('00'.repeat(800_001));
    await expect(client.getTransactionHex('ab'.repeat(32))).rejects.toBeInstanceOf(
      ElectrumInvalidResponseError,
    );

    vi.mocked(client.request).mockResolvedValueOnce('not-a-status-hash');
    await expect(client.subscribeAddressStatus(address, () => undefined)).rejects.toBeInstanceOf(
      ElectrumInvalidResponseError,
    );

    vi.mocked(client.request).mockResolvedValueOnce({
      vin: [{ txid: 'not-a-txid', vout: 0 }],
      vout: [{ n: 0, value: 1 }],
    });
    await expect(client.getVerboseTransaction('ab'.repeat(32))).rejects.toBeInstanceOf(
      ElectrumInvalidResponseError,
    );

    const handleMessage = (client as unknown as { handleMessage(raw: string): void })
      .handleMessage.bind(client);
    expect(() => handleMessage(JSON.stringify({
      method: 'blockchain.headers.subscribe',
      params: [{}],
    }))).toThrow(ElectrumInvalidResponseError);
    expect(() => handleMessage(JSON.stringify({
      method: 'blockchain.scripthash.subscribe',
      params: ['ab'.repeat(32), 'not-a-status-hash'],
    }))).toThrow(ElectrumInvalidResponseError);
  });

  it('uses the locally signed txid and rejects a conflicting broadcast response', async () => {
    const client = new NitoElectrumClient();
    vi.spyOn(client, 'request').mockResolvedValue('ab'.repeat(32));

    await expect(
      client.broadcastTransaction('00', 'ab'.repeat(32)),
    ).resolves.toBe('ab'.repeat(32));
    await expect(
      client.broadcastTransaction('00', 'cd'.repeat(32)),
    ).rejects.toBeInstanceOf(ElectrumInvalidResponseError);
  });

  it('shares one socket handshake across concurrent connect calls', async () => {
    class FakeWebSocket {
      static instances = 0;

      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;

      constructor(_url: string) {
        FakeWebSocket.instances += 1;
        queueMicrotask(() => this.onopen?.());
      }

      send(raw: string) {
        const request = JSON.parse(raw) as { id: number; method: string };
        const result = request.method === 'blockchain.headers.subscribe'
          ? { height: 123 }
          : ['Nito-ElectrumX', '1.4'];
        queueMicrotask(() => {
          this.onmessage?.({ data: JSON.stringify({ id: request.id, result }) });
        });
      }

      close() {
        this.onclose?.();
      }
    }

    vi.stubGlobal('WebSocket', FakeWebSocket);
    const client = new NitoElectrumClient();

    await Promise.all([client.connect(), client.connect(), client.connect(), client.connect()]);

    expect(FakeWebSocket.instances).toBe(1);
    expect(client.connected).toBe(true);
    expect(client.blockHeight).toBe(123);
    client.disconnect();
  });

  it('names the attempted server when the server.version handshake is rejected', async () => {
    class RejectingHandshakeWebSocket {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;

      constructor(_url: string) {
        queueMicrotask(() => this.onopen?.());
      }

      send(raw: string) {
        const request = JSON.parse(raw) as { id: number };
        queueMicrotask(() => {
          this.onmessage?.({
            data: JSON.stringify({
              id: request.id,
              error: { code: -32000, message: 'unsupported protocol' },
            }),
          });
        });
      }

      close() {
        this.onclose?.();
      }
    }

    vi.stubGlobal('WebSocket', RejectingHandshakeWebSocket);
    const client = new NitoElectrumClient([
      { host: 'private.example.org', port: 50005, protocol: 'wss', priority: 1 },
    ]);

    await expect(client.connect()).rejects.toThrow(
      'wss://private.example.org:50005',
    );
  });

  it('marks a persistently failing session unhealthy and reconnects before the next read', async () => {
    class RecoveringFakeWebSocket {
      static instances = 0;
      static readAttempts = 0;
      static failReads = true;

      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;

      constructor(_url: string) {
        RecoveringFakeWebSocket.instances += 1;
        queueMicrotask(() => this.onopen?.());
      }

      send(raw: string) {
        const request = JSON.parse(raw) as { id: number; method: string };
        if (request.method === 'failing.read') {
          RecoveringFakeWebSocket.readAttempts += 1;
        }
        const fails = request.method === 'failing.read' && RecoveringFakeWebSocket.failReads;
        const result = request.method === 'blockchain.headers.subscribe'
          ? { height: 123 }
          : request.method === 'server.version'
            ? ['Nito-ElectrumX', '1.4']
            : [];
        queueMicrotask(() => {
          this.onmessage?.({
            data: JSON.stringify(
              fails
                ? { id: request.id, error: { code: -32000, message: 'temporary read failure' } }
                : { id: request.id, result },
            ),
          });
        });
      }

      close() {
        this.onclose?.();
      }
    }

    vi.stubGlobal('WebSocket', RecoveringFakeWebSocket);
    const client = new NitoElectrumClient(
      [{ host: 'recovery.invalid', port: 50005, protocol: 'wss', priority: 1 }],
      { timeoutMs: 1_000, maxConcurrentRequests: 6 },
    );
    await client.connect();

    await expect(client.request('failing.read')).rejects.toThrow('temporary read failure');
    expect(RecoveringFakeWebSocket.readAttempts).toBe(3);
    expect(client.connected).toBe(false);

    RecoveringFakeWebSocket.failReads = false;
    await expect(client.request('failing.read')).resolves.toEqual([]);
    expect(RecoveringFakeWebSocket.instances).toBe(2);
    expect(client.connected).toBe(true);
    client.disconnect();
  });

  it('rotates to the secondary server after a primary session fails during a read', async () => {
    class FailingPrimaryWebSocket {
      static urls: string[] = [];

      readonly url: string;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;

      constructor(url: string) {
        this.url = url;
        FailingPrimaryWebSocket.urls.push(url);
        queueMicrotask(() => this.onopen?.());
      }

      send(raw: string) {
        const request = JSON.parse(raw) as { id: number; method: string };
        const primary = this.url.includes('primary.invalid');
        const response = request.method === 'server.version'
          ? { id: request.id, result: ['Nito-ElectrumX', '1.4'] }
          : request.method === 'blockchain.headers.subscribe'
            ? { id: request.id, result: { height: 123 } }
            : primary
              ? { id: request.id, error: { code: -32000, message: 'primary read failed' } }
              : { id: request.id, result: ['secondary-result'] };
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(response) }));
      }

      close() {
        this.onclose?.();
      }
    }

    vi.stubGlobal('WebSocket', FailingPrimaryWebSocket);
    const client = new NitoElectrumClient([
      { host: 'primary.invalid', port: 50005, protocol: 'wss', priority: 1 },
      { host: 'secondary.invalid', port: 50005, protocol: 'wss', priority: 2 },
    ]);
    await client.connect();

    await expect(client.request('wallet.read')).rejects.toThrow('primary read failed');
    await expect(client.request('wallet.read')).resolves.toEqual(['secondary-result']);

    expect(FailingPrimaryWebSocket.urls).toEqual([
      'wss://primary.invalid:50005',
      'wss://secondary.invalid:50005',
    ]);
    client.disconnect();
  });

  it('reconnects automatically and restores address subscriptions after an unexpected close', async () => {
    vi.useFakeTimers();
    class ReconnectingWebSocket {
      static instances: ReconnectingWebSocket[] = [];

      readonly generation: number;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;

      constructor(_url: string) {
        this.generation = ReconnectingWebSocket.instances.length + 1;
        ReconnectingWebSocket.instances.push(this);
        queueMicrotask(() => this.onopen?.());
      }

      send(raw: string) {
        const request = JSON.parse(raw) as { id: number; method: string };
        const result = request.method === 'server.version'
          ? ['Nito-ElectrumX', '1.4']
          : request.method === 'blockchain.headers.subscribe'
            ? { height: 123, hex: 'aa' }
            : request.method === 'blockchain.scripthash.subscribe'
              ? this.generation.toString(16).padStart(64, '0')
              : [];
        queueMicrotask(() => this.onmessage?.({
          data: JSON.stringify({ id: request.id, result }),
        }));
      }

      close() {
        this.onclose?.();
      }
    }

    vi.stubGlobal('WebSocket', ReconnectingWebSocket);
    const client = new NitoElectrumClient(
      [{ host: 'reconnect.invalid', port: 50005, protocol: 'wss', priority: 1 }],
      { reconnectDelayMs: 1 },
    );
    const connectionStates: boolean[] = [];
    client.subscribeConnectionState((state) => connectionStates.push(state.connected));
    await client.connect();
    const replayedStatuses: (string | null)[] = [];
    const subscription = await client.subscribeAddressStatus(
      address,
      (status) => replayedStatuses.push(status),
    );

    ReconnectingWebSocket.instances[0]?.onclose?.();
    await vi.advanceTimersByTimeAsync(1);

    expect(ReconnectingWebSocket.instances).toHaveLength(2);
    expect(replayedStatuses).toEqual(['2'.padStart(64, '0')]);
    expect(connectionStates).toEqual([true, false, true]);
    expect(client.connected).toBe(true);
    subscription.unsubscribe();
    client.disconnect();
  });

  it('rejects an active request immediately when its socket closes', async () => {
    class ClosingFakeWebSocket {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;

      constructor(_url: string) {
        queueMicrotask(() => this.onopen?.());
      }

      send(raw: string) {
        const request = JSON.parse(raw) as { id: number; method: string };
        if (request.method === 'closing.read') {
          queueMicrotask(() => this.onclose?.());
          return;
        }
        const result = request.method === 'blockchain.headers.subscribe'
          ? { height: 123 }
          : ['Nito-ElectrumX', '1.4'];
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: request.id, result }) }));
      }

      close() {
        this.onclose?.();
      }
    }

    vi.stubGlobal('WebSocket', ClosingFakeWebSocket);
    const client = new NitoElectrumClient(
      [{ host: 'closing.invalid', port: 50005, protocol: 'wss', priority: 1 }],
      { timeoutMs: 250, maxConcurrentRequests: 6 },
    );
    await client.connect();

    await expect(client.request('closing.read')).rejects.toThrow('connection closed');
    expect(client.connected).toBe(false);
  });

  it('applies a configurable global ceiling and starts timeouts only after dispatch', async () => {
    vi.useFakeTimers();
    class DelayedFakeWebSocket {
      static inFlight = 0;
      static peakInFlight = 0;

      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;

      constructor(_url: string) {
        queueMicrotask(() => this.onopen?.());
      }

      send(raw: string) {
        const request = JSON.parse(raw) as { id: number; method: string };
        DelayedFakeWebSocket.inFlight += 1;
        DelayedFakeWebSocket.peakInFlight = Math.max(
          DelayedFakeWebSocket.peakInFlight,
          DelayedFakeWebSocket.inFlight,
        );
        const result = request.method === 'blockchain.headers.subscribe'
          ? { height: 123 }
          : request.method === 'server.version'
            ? ['Nito-ElectrumX', '1.4']
            : [];
        setTimeout(() => {
          DelayedFakeWebSocket.inFlight -= 1;
          this.onmessage?.({ data: JSON.stringify({ id: request.id, result }) });
        }, 8);
      }

      close() {
        this.onclose?.();
      }
    }

    vi.stubGlobal('WebSocket', DelayedFakeWebSocket);
    const client = new NitoElectrumClient(
      [{ host: 'benchmark.invalid', port: 50005, protocol: 'wss', priority: 1 }],
      { timeoutMs: 20, maxConcurrentRequests: 2 },
    );
    const connection = client.connect();
    await vi.runAllTimersAsync();
    await connection;
    client.resetRequestMetrics();

    const reads = Promise.all(Array.from({ length: 8 }, () => client.request('benchmark.read')));
    await vi.runAllTimersAsync();
    await reads;

    const metrics = client.getRequestMetrics();
    expect(DelayedFakeWebSocket.peakInFlight).toBe(2);
    expect(metrics).toMatchObject({
      totalRequests: 8,
      successfulRequests: 8,
      failedRequests: 0,
      peakInFlight: 2,
      maxQueueDepth: 6,
    });
    expect(metrics.totalQueueWaitMs).toBeGreaterThan(0);
    client.disconnect();
  });

  it('completes a full scan when the server refuses overload, while legacy-equivalent concurrency fails', async () => {
    vi.useFakeTimers();
    class RefusingOverloadWebSocket {
      static inFlight = 0;
      static peakInFlight = 0;
      static overloaded = false;

      static reset() {
        RefusingOverloadWebSocket.inFlight = 0;
        RefusingOverloadWebSocket.peakInFlight = 0;
        RefusingOverloadWebSocket.overloaded = false;
      }

      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;

      constructor(_url: string) {
        queueMicrotask(() => this.onopen?.());
      }

      send(raw: string) {
        const request = JSON.parse(raw) as { id: number; method: string };
        RefusingOverloadWebSocket.inFlight += 1;
        RefusingOverloadWebSocket.peakInFlight = Math.max(
          RefusingOverloadWebSocket.peakInFlight,
          RefusingOverloadWebSocket.inFlight,
        );
        if (RefusingOverloadWebSocket.inFlight > 6) {
          RefusingOverloadWebSocket.overloaded = true;
        }
        const refused = RefusingOverloadWebSocket.overloaded;
        const result = request.method === 'server.version'
          ? ['Nito-ElectrumX', '1.4']
          : request.method === 'blockchain.headers.subscribe'
            ? { height: 123 }
            : [];

        setTimeout(() => {
          RefusingOverloadWebSocket.inFlight -= 1;
          this.onmessage?.({
            data: JSON.stringify(
              refused
                ? { id: request.id, error: { code: -32000, message: 'rate limited' } }
                : { id: request.id, result },
            ),
          });
        }, 2);
      }

      close() {
        this.onclose?.();
      }
    }

    vi.stubGlobal('WebSocket', RefusingOverloadWebSocket);
    const servers = [{ host: 'overload.invalid', port: 50005, protocol: 'wss' as const, priority: 1 }];
    const legacyEquivalentClient = new NitoElectrumClient(servers, {
      timeoutMs: 1_000,
      maxConcurrentRequests: 40,
    });

    const legacyScan = scanTransparentWallet({
      mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      electrum: legacyEquivalentClient,
      gapLimit: 20,
      crypto: createNitoWalletCryptoTestDouble(),
      maxConcurrentNetworkRequests: 40,
    });
    const legacyFailure = expect(legacyScan).rejects.toThrow('rate limited');
    await vi.runAllTimersAsync();
    await legacyFailure;
    expect(RefusingOverloadWebSocket.overloaded).toBe(true);
    expect(RefusingOverloadWebSocket.peakInFlight).toBeGreaterThan(6);
    legacyEquivalentClient.disconnect();

    RefusingOverloadWebSocket.reset();
    const limitedClient = new NitoElectrumClient(servers, {
      timeoutMs: 1_000,
      maxConcurrentRequests: 6,
    });
    const limitedScan = scanTransparentWallet({
      mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      electrum: limitedClient,
      gapLimit: 20,
      crypto: createNitoWalletCryptoTestDouble(),
    });
    await vi.runAllTimersAsync();
    const completeSnapshot = await limitedScan;

    expect(completeSnapshot.addresses).toHaveLength(160);
    expect(RefusingOverloadWebSocket.overloaded).toBe(false);
    expect(RefusingOverloadWebSocket.peakInFlight).toBe(6);
    limitedClient.disconnect();
  });

  it('keeps a cold full scan below the global RPC concurrency ceiling', async () => {
    class ThrottledFakeWebSocket {
      static inFlight = 0;
      static peakInFlight = 0;
      static requestCount = 0;

      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;

      constructor(_url: string) {
        queueMicrotask(() => this.onopen?.());
      }

      send(raw: string) {
        const request = JSON.parse(raw) as { id: number; method: string };
        ThrottledFakeWebSocket.requestCount += 1;
        ThrottledFakeWebSocket.inFlight += 1;
        ThrottledFakeWebSocket.peakInFlight = Math.max(
          ThrottledFakeWebSocket.peakInFlight,
          ThrottledFakeWebSocket.inFlight,
        );
        const delayMs = ThrottledFakeWebSocket.inFlight > 10 ? 20 : 1;
        const result = request.method === 'server.version'
          ? ['Nito-ElectrumX', '1.4']
          : request.method === 'blockchain.headers.subscribe'
            ? { height: 123 }
            : [];
        setTimeout(() => {
          ThrottledFakeWebSocket.inFlight -= 1;
          this.onmessage?.({ data: JSON.stringify({ id: request.id, result }) });
        }, delayMs);
      }

      close() {
        this.onclose?.();
      }
    }

    vi.stubGlobal('WebSocket', ThrottledFakeWebSocket);
    const client = new NitoElectrumClient(
      [{ host: 'benchmark.invalid', port: 50005, protocol: 'wss', priority: 1 }],
      1_000,
    );
    const startedAt = performance.now();
    await client.connect();
    const snapshot = await scanTransparentWallet({
      mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      electrum: client,
      gapLimit: 20,
      crypto: createNitoWalletCryptoTestDouble(),
    });
    const durationMs = performance.now() - startedAt;
    const metrics = client.getRequestMetrics();
    console.info(`NITO_SYNTHETIC_BENCHMARK ${JSON.stringify({
      ...metrics,
      retries: metrics.failedRequests,
      addressCount: snapshot.addresses.length,
      durationMs: Math.round(durationMs),
    })}`);

    expect(snapshot.addresses).toHaveLength(160);
    expect(ThrottledFakeWebSocket.requestCount).toBe(162);
    expect(metrics.totalRequests).toBe(162);
    expect(metrics.successfulRequests).toBe(162);
    expect(metrics.failedRequests).toBe(0);
    expect({
      peakInFlight: metrics.peakInFlight,
      durationMs: Math.round(durationMs),
    }).toMatchObject({ peakInFlight: 6 });
    expect(ThrottledFakeWebSocket.peakInFlight).toBe(6);
    client.disconnect();
  });
});

const liveBenchmark = process.env.NITO_LIVE_BENCHMARK === '1' ? it : it.skip;

liveBenchmark('measures one real cold Electrum scan with the public test mnemonic', async () => {
  const client = new NitoElectrumClient();
  const startedAt = performance.now();
  try {
    await client.connect();
    client.resetRequestMetrics();
    const snapshot = await scanTransparentWallet({
      mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      electrum: client,
      gapLimit: 20,
      crypto: createNitoWalletCryptoTestDouble(),
    });
    const requestMetrics = client.getRequestMetrics();
    const metrics = {
      ...requestMetrics,
      retries: requestMetrics.failedRequests,
      addressCount: snapshot.addresses.length,
      durationMs: Math.round(performance.now() - startedAt),
    };
    console.info(`NITO_LIVE_BENCHMARK ${JSON.stringify(metrics)}`);
    expect(snapshot.addresses).toHaveLength(160);
  } finally {
    client.disconnect();
  }
}, 600_000);
