import { sha256 } from '@noble/hashes/sha2.js';
import * as btc from '@scure/btc-signer';
import { bech32, bech32m } from 'bech32';

const ELECTRUM_PROTOCOL_VERSION = '1.4';
const DEFAULT_TIMEOUT_MS = 30_000;

export type ElectrumServer = {
  host: string;
  port: number;
  protocol: 'wss';
  priority: number;
};

export type ElectrumBalance = {
  confirmedSats: number;
  unconfirmedSats: number;
  totalSats: number;
};

export type ElectrumUtxo = {
  txid: string;
  vout: number;
  valueSats: number;
  height: number;
  address: string;
  confirmations: number;
  isCoinbase?: boolean;
  rawTx?: string;
};

export type ElectrumHistoryEntry = {
  txid: string;
  height: number;
  address: string;
};

export type ElectrumVerboseTransaction = {
  txid?: string;
  vin: {
    txid?: string;
    vout?: number;
    coinbase?: string;
  }[];
  vout: {
    n?: number;
    value: number | string;
    scriptPubKey?: {
      address?: string;
      addresses?: string[];
    };
  }[];
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type JsonRpcResponse = {
  id?: number;
  method?: string;
  params?: unknown[];
  result?: unknown;
  error?: { message?: string; code?: number };
};

type ScripthashStatusListener = (status: string | null) => void;
type BlockHeightListener = (height: number, previousHeight: number) => void;

export const NITO_ELECTRUM_SERVERS: ElectrumServer[] = [
  { host: 'electrum1.nito.network', port: 50005, protocol: 'wss', priority: 1 },
  { host: 'electrum1.nitopool.fr', port: 50005, protocol: 'wss', priority: 2 },
];

const NITO_ADDRESS_NETWORK = {
  bech32: 'nito',
  pubKeyHash: 0x00,
  scriptHash: 0x05,
  wif: 0x80,
  bip32: {
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
};

const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const concatBytes = (...chunks: Uint8Array[]) => {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
};

const opForWitnessVersion = (version: number) => {
  if (version === 0) {
    return 0x00;
  }

  if (version >= 1 && version <= 16) {
    return 0x50 + version;
  }

  throw new Error(`Unsupported witness version: ${version}`);
};

export const scriptPubKeyForNitoAddress = (address: string) => {
  const normalized = address.trim();
  const lower = normalized.toLowerCase();

  if (!lower.startsWith('nito1')) {
    const decoded = btc.Address(NITO_ADDRESS_NETWORK).decode(normalized);

    if (decoded && decoded.type === 'pkh' && 'hash' in decoded) {
      const hash = Uint8Array.from(decoded.hash);
      return concatBytes(Uint8Array.from([0x76, 0xa9, 0x14]), hash, Uint8Array.from([0x88, 0xac]));
    }

    if (decoded && decoded.type === 'sh' && 'hash' in decoded) {
      const hash = Uint8Array.from(decoded.hash);
      return concatBytes(Uint8Array.from([0xa9, 0x14]), hash, Uint8Array.from([0x87]));
    }

    throw new Error('Unsupported Nito address.');
  }

  if (!lower.startsWith('nito1q') && !lower.startsWith('nito1p')) {
    throw new Error('Private address unavailable in this public version.');
  }

  const decoded = lower.startsWith('nito1p') ? bech32m.decode(lower) : bech32.decode(lower);

  if (decoded.prefix !== 'nito') {
    throw new Error(`Prefixe Bech32 inattendu: ${decoded.prefix}`);
  }

  const [version, ...programWords] = decoded.words;
  if (typeof version !== 'number') {
    throw new Error('Version witness manquante.');
  }

  const program = Uint8Array.from(bech32.fromWords(programWords));

  return concatBytes(Uint8Array.from([opForWitnessVersion(version), program.length]), program);
}
export const electrumScripthashFromScript = (scriptPubKey: Uint8Array) => {
  const digest = sha256(scriptPubKey);
  return toHex(Uint8Array.from(digest).reverse());
};

export const addressToElectrumScripthash = (address: string) =>
  electrumScripthashFromScript(scriptPubKeyForNitoAddress(address));

export class NitoElectrumClient {
  private readonly servers: ElectrumServer[];
  private readonly timeoutMs: number;
  private currentServerIndex = 0;
  private requestId = 1;
  private socket: WebSocket | null = null;
  private pending = new Map<number, PendingRequest>();
  private scripthashListeners = new Map<string, Set<ScripthashStatusListener>>();
  private blockHeightListeners = new Set<BlockHeightListener>();

  connected = false;
  blockHeight = 0;

  constructor(servers = NITO_ELECTRUM_SERVERS, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.servers = [...servers].sort((a, b) => a.priority - b.priority);
    this.timeoutMs = timeoutMs;
  }

  get currentServerUrl() {
    const server = this.servers[this.currentServerIndex];
    if (!server) {
      throw new Error('No ElectrumX server configured.');
    }

    return `${server.protocol}://${server.host}:${server.port}`;
  }

  async connect() {
    if (this.connected) {
      return;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.servers.length; attempt += 1) {
      try {
        await this.openSocket(this.currentServerUrl);
        await this.requestRaw('server.version', ['Nito-Mobile-Wallet', ELECTRUM_PROTOCOL_VERSION]);
        const header = await this.requestRaw<{ height?: number }>('blockchain.headers.subscribe', []);
        this.blockHeight = Number(header?.height || 0);
        return;
      } catch (caught) {
        lastError = caught instanceof Error ? caught : new Error('Unlock ElectrumX impossible.');
        this.disconnect();
        this.currentServerIndex = (this.currentServerIndex + 1) % this.servers.length;
      }
    }

    throw lastError || new Error('Tous les serveurs ElectrumX sont indisponibles.');
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
    }

    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('ElectrumX connection closed.'));
    }

    this.pending.clear();
    this.socket = null;
    this.connected = false;
  }

  async request<T>(method: string, params: unknown[] = []) {
    if (!this.connected) {
      await this.connect();
    }

    return this.requestRaw<T>(method, params);
  }

  async getAddressBalance(address: string): Promise<ElectrumBalance> {
    const scripthash = addressToElectrumScripthash(address);
    const balance = await this.request<{ confirmed: number; unconfirmed: number }>(
      'blockchain.scripthash.get_balance',
      [scripthash],
    );

    return {
      confirmedSats: balance.confirmed,
      unconfirmedSats: balance.unconfirmed,
      totalSats: balance.confirmed + balance.unconfirmed,
    };
  }

  async getAddressUtxos(address: string): Promise<ElectrumUtxo[]> {
    const scripthash = addressToElectrumScripthash(address);
    const utxos = await this.request<{ tx_hash: string; tx_pos: number; value: number; height: number }[]>(
      'blockchain.scripthash.listunspent',
      [scripthash],
    );

    return utxos.map((utxo) => ({
      txid: utxo.tx_hash,
      vout: utxo.tx_pos,
      valueSats: utxo.value,
      height: utxo.height,
      address,
      confirmations: utxo.height > 0 && this.blockHeight > 0 ? Math.max(0, this.blockHeight - utxo.height + 1) : 0,
    }));
  }

  async getAddressHistory(address: string): Promise<ElectrumHistoryEntry[]> {
    const scripthash = addressToElectrumScripthash(address);
    const history = await this.request<{ tx_hash: string; height: number }[]>('blockchain.scripthash.get_history', [
      scripthash,
    ]);

    return history.map((entry) => ({ txid: entry.tx_hash, height: entry.height, address }));
  }

  async subscribeAddressStatus(
    address: string,
    listener: (status: string | null, address: string) => void,
  ) {
    const scripthash = addressToElectrumScripthash(address);
    const wrappedListener: ScripthashStatusListener = (status) => listener(status, address);
    const listeners = this.scripthashListeners.get(scripthash) ?? new Set<ScripthashStatusListener>();
    listeners.add(wrappedListener);
    this.scripthashListeners.set(scripthash, listeners);

    const unsubscribe = () => {
      const current = this.scripthashListeners.get(scripthash);
      current?.delete(wrappedListener);

      if (current && current.size === 0) {
        this.scripthashListeners.delete(scripthash);
      }
    };

    try {
      const status = await this.request<string | null>('blockchain.scripthash.subscribe', [scripthash]);
      return { status, unsubscribe };
    } catch (error) {
      unsubscribe();
      throw error;
    }
  }

  async broadcastTransaction(txHex: string) {
    return this.request<string>('blockchain.transaction.broadcast', [txHex]);
  }

  async getTransactionHex(txid: string) {
    return this.request<string>('blockchain.transaction.get', [txid]);
  }

  async getVerboseTransaction(txid: string) {
    const transaction = await this.request<ElectrumVerboseTransaction>('blockchain.transaction.get', [txid, true]);

    if (!transaction || typeof transaction !== 'object' || !Array.isArray(transaction.vin) || !Array.isArray(transaction.vout)) {
      throw new Error(`ElectrumX returned invalid transaction details for ${txid}.`);
    }

    return transaction;
  }

  subscribeBlockHeight(listener: BlockHeightListener) {
    this.blockHeightListeners.add(listener);
    return () => {
      this.blockHeightListeners.delete(listener);
    };
  }

  private openSocket(url: string) {
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`Timeout ElectrumX: ${url}`));
      }, this.timeoutMs);

      socket.onopen = () => {
        clearTimeout(timer);
        this.socket = socket;
        this.connected = true;
        resolve();
      };

      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`ElectrumX WebSocket error: ${url}`));
      };

      socket.onclose = () => {
        this.connected = false;
      };

      socket.onmessage = (event) => {
        this.handleMessage(event.data);
      };
    });
  }

  private requestRaw<T = unknown>(method: string, params: unknown[] = []) {
    if (!this.socket || !this.connected) {
      return Promise.reject(new Error('ElectrumX not connected.'));
    }

    return new Promise<T>((resolve, reject) => {
      const id = this.requestId;
      this.requestId += 1;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout ElectrumX: ${method}`));
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      this.socket?.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }));
    });
  }

  private handleMessage(raw: string) {
    const message = JSON.parse(raw) as JsonRpcResponse;

    if (message.method === 'blockchain.headers.subscribe') {
      const header = Array.isArray(message.params) ? (message.params[0] as { height?: number }) : undefined;
      const previousHeight = this.blockHeight;
      const nextHeight = Number(header?.height || previousHeight);
      this.blockHeight = nextHeight;

      if (nextHeight > previousHeight) {
        this.blockHeightListeners.forEach((listener) => listener(nextHeight, previousHeight));
      }
      return;
    }

    if (message.method === 'blockchain.scripthash.subscribe') {
      const [scripthash, status] = Array.isArray(message.params) ? message.params : [];

      if (typeof scripthash === 'string') {
        const listeners = this.scripthashListeners.get(scripthash);
        listeners?.forEach((listener) => listener(typeof status === 'string' ? status : null));
      }

      return;
    }

    if (typeof message.id !== 'number') {
      return;
    }

    const request = this.pending.get(message.id);
    if (!request) {
      return;
    }

    clearTimeout(request.timer);
    this.pending.delete(message.id);

    if (message.error) {
      request.reject(new Error(message.error.message || `ElectrumX error ${message.error.code || ''}`.trim()));
      return;
    }

    request.resolve(message.result);
  }
}
