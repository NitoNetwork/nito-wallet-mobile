import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createElectrumClient,
  getElectrumServerPreference,
  loadElectrumServerPreference,
  parseCustomElectrumServerUrl,
  restoreOfficialElectrumServers,
  saveCustomElectrumServerPreference,
} from './electrumClientFactory';

const secureStore = vi.hoisted(() => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));
const diagnostics = vi.hoisted(() => ({
  reportNonFinancialFailure: vi.fn(),
}));

vi.mock('expo-secure-store', () => secureStore);
vi.mock('./diagnostics', () => diagnostics);

describe('Electrum client factory', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    secureStore.getItemAsync.mockResolvedValue(null);
    secureStore.setItemAsync.mockResolvedValue(undefined);
    secureStore.deleteItemAsync.mockResolvedValue(undefined);
    await loadElectrumServerPreference();
  });

  it('accepts only manually entered WSS hosts with a valid port', () => {
    expect(parseCustomElectrumServerUrl(' wss://node.example.org:50005 ')).toEqual({
      host: 'node.example.org',
      port: 50005,
      protocol: 'wss',
      priority: 1,
    });
    expect(parseCustomElectrumServerUrl('wss://192.0.2.10:443').host).toBe('192.0.2.10');
    expect(() => parseCustomElectrumServerUrl('ws://node.example.org:50005')).toThrow(
      'wss',
    );
    expect(() => parseCustomElectrumServerUrl('wss://bad_host:50005')).toThrow('host');
    expect(() => parseCustomElectrumServerUrl('wss://node.example.org:0')).toThrow('port');
    expect(() => parseCustomElectrumServerUrl('wss://node.example.org:65536')).toThrow('port');
    expect(() => parseCustomElectrumServerUrl('wss://node.example.org:50005/path')).toThrow(
      'format',
    );
  });

  it('uses a saved custom server exclusively and names it when connection fails', async () => {
    const openedUrls: string[] = [];
    class RefusingWebSocket {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;

      constructor(url: string) {
        openedUrls.push(url);
        queueMicrotask(() => this.onerror?.());
      }

      send() {}
      close() {
        this.onclose?.();
      }
    }
    vi.stubGlobal('WebSocket', RefusingWebSocket);
    secureStore.getItemAsync.mockResolvedValueOnce('wss://private.example.org:50005');

    await loadElectrumServerPreference();
    const client = createElectrumClient();

    await expect(client.connect()).rejects.toThrow('wss://private.example.org:50005');
    expect(openedUrls).toEqual(['wss://private.example.org:50005']);

    await restoreOfficialElectrumServers();
    expect(getElectrumServerPreference().mode).toBe('official');
    expect(createElectrumClient().currentServerUrl).toContain('electrum1.nito.network');
  });

  it('performs server.version before persisting and invalidates before activation', async () => {
    const methods: string[] = [];
    class HandshakeWebSocket {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;

      constructor(_url: string) {
        queueMicrotask(() => this.onopen?.());
      }

      send(raw: string) {
        const request = JSON.parse(raw) as { id: number; method: string };
        methods.push(request.method);
        const result = request.method === 'server.version'
          ? ['Nito-ElectrumX', '1.4']
          : { height: 952_543 };
        queueMicrotask(() => {
          this.onmessage?.({ data: JSON.stringify({ id: request.id, result }) });
        });
      }

      close() {
        this.onclose?.();
      }
    }
    vi.stubGlobal('WebSocket', HandshakeWebSocket);
    let modeDuringInvalidation = '';

    const preference = await saveCustomElectrumServerPreference(
      'wss://private.example.org:50005',
      () => {
        modeDuringInvalidation = getElectrumServerPreference().mode;
      },
    );

    expect(methods).toContain('server.version');
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      expect.any(String),
      'wss://private.example.org:50005',
    );
    expect(modeDuringInvalidation).toBe('official');
    expect(preference).toMatchObject({
      mode: 'custom',
      customServerUrl: 'wss://private.example.org:50005',
    });
    expect(createElectrumClient().currentServerUrl).toBe(
      'wss://private.example.org:50005',
    );
  });

  it('never saves or activates a server with an invalid server.version response', async () => {
    class InvalidHandshakeWebSocket {
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
          this.onmessage?.({ data: JSON.stringify({ id: request.id, result: null }) });
        });
      }
      close() {
        this.onclose?.();
      }
    }
    vi.stubGlobal('WebSocket', InvalidHandshakeWebSocket);

    await expect(
      saveCustomElectrumServerPreference('wss://offline.example.org:50005'),
    ).rejects.toThrow('wss://offline.example.org:50005');
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
    expect(getElectrumServerPreference().mode).toBe('official');
  });

  it('keeps settings recoverable after an unreadable preference or an offline custom server', async () => {
    secureStore.getItemAsync.mockResolvedValueOnce('invalid persisted value');
    await expect(loadElectrumServerPreference()).resolves.toMatchObject({
      mode: 'recovery',
    });
    expect(() => createElectrumClient()).toThrow('Settings');

    const invalidations: string[] = [];
    await restoreOfficialElectrumServers(() => invalidations.push('invalidated'));
    expect(invalidations).toEqual(['invalidated']);
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(expect.any(String));
    expect(getElectrumServerPreference().mode).toBe('official');
    expect(createElectrumClient().currentServerUrl).toContain('electrum1.nito.network');
  });
});
