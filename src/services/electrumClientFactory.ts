import * as SecureStore from 'expo-secure-store';

import {
  NITO_ELECTRUM_SERVERS,
  NitoElectrumClient,
  type ElectrumServer,
} from '../network/electrum';
import { reportNonFinancialFailure } from './diagnostics';

const ELECTRUM_SERVER_PREFERENCE_KEY = 'nito.wallet.electrum-server.v1';

export type ElectrumServerPreference =
  | {
      mode: 'official';
      customServerUrl: null;
      error: '';
    }
  | {
      mode: 'custom';
      customServerUrl: string;
      error: '';
    }
  | {
      mode: 'recovery';
      customServerUrl: null;
      error: string;
    };

export type CustomElectrumServerValidationCode =
  | 'wss-required'
  | 'invalid-format'
  | 'invalid-host'
  | 'invalid-port';

export class CustomElectrumServerValidationError extends Error {
  readonly code: CustomElectrumServerValidationCode;

  constructor(code: CustomElectrumServerValidationCode, message: string) {
    super(message);
    this.name = 'CustomElectrumServerValidationError';
    this.code = code;
  }
}

let activePreference: ElectrumServerPreference = {
  mode: 'recovery',
  customServerUrl: null,
  error: 'Electrum server configuration is not loaded. Open Settings to restore official servers.',
};

const officialPreference = (): ElectrumServerPreference => ({
  mode: 'official',
  customServerUrl: null,
  error: '',
});

const customPreference = (customServerUrl: string): ElectrumServerPreference => ({
  mode: 'custom',
  customServerUrl,
  error: '',
});

const recoveryPreference = (error: string): ElectrumServerPreference => ({
  mode: 'recovery',
  customServerUrl: null,
  error,
});

const isValidIpv4 = (host: string): boolean => {
  const octets = host.split('.');
  return octets.length === 4 && octets.every((octet) => (
    /^\d{1,3}$/.test(octet)
    && Number(octet) >= 0
    && Number(octet) <= 255
    && (octet === '0' || !octet.startsWith('0'))
  ));
};

const isValidIpv6 = (host: string): boolean => {
  if (!host.includes(':') || !/^[0-9a-f:.]+$/i.test(host)) return false;
  if ((host.match(/::/g) ?? []).length > 1) return false;
  const [left = '', right = ''] = host.split('::');
  const parts = [...left.split(':'), ...right.split(':')].filter(Boolean);
  const ipv4Tail = parts.at(-1)?.includes('.') ? parts.pop() : undefined;
  if (ipv4Tail && !isValidIpv4(ipv4Tail)) return false;
  if (!parts.every((part) => /^[0-9a-f]{1,4}$/i.test(part))) return false;
  const groupCount = parts.length + (ipv4Tail ? 2 : 0);
  return host.includes('::') ? groupCount < 8 : groupCount === 8;
};

const isValidDnsHost = (host: string): boolean => (
  host.length <= 253
  && host.split('.').every((label) => (
    label.length >= 1
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  ))
);

const formatElectrumServerUrl = (server: ElectrumServer): string =>
  `${server.protocol}://${server.host}:${server.port}`;

export const parseCustomElectrumServerUrl = (input: string): ElectrumServer => {
  const normalized = input.trim();
  if (!/^wss:\/\//i.test(normalized)) {
    throw new CustomElectrumServerValidationError(
      'wss-required',
      'Custom Electrum server must use wss://.',
    );
  }

  const match = normalized.match(/^wss:\/\/(\[[0-9a-f:.]+\]|[^/?#@:]+):(\d+)$/i);
  if (!match) {
    throw new CustomElectrumServerValidationError(
      'invalid-format',
      'Invalid custom Electrum server format. Use wss://host:port.',
    );
  }

  const rawHost = match[1] ?? '';
  const rawPort = match[2] ?? '';
  const isBracketedIpv6 = rawHost.startsWith('[') && rawHost.endsWith(']');
  const unwrappedHost = isBracketedIpv6 ? rawHost.slice(1, -1) : rawHost;
  const numericHost = /^[0-9.]+$/.test(unwrappedHost);
  const hostIsValid = isBracketedIpv6
    ? isValidIpv6(unwrappedHost)
    : numericHost
      ? isValidIpv4(unwrappedHost)
      : isValidDnsHost(unwrappedHost);
  if (!hostIsValid) {
    throw new CustomElectrumServerValidationError(
      'invalid-host',
      'Invalid custom Electrum server host.',
    );
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new CustomElectrumServerValidationError(
      'invalid-port',
      'Invalid custom Electrum server port. Use a value from 1 to 65535.',
    );
  }

  return {
    host: isBracketedIpv6 ? `[${unwrappedHost.toLowerCase()}]` : unwrappedHost.toLowerCase(),
    port,
    protocol: 'wss',
    priority: 1,
  };
};

const instantiateElectrumClient = (servers?: ElectrumServer[]) =>
  new NitoElectrumClient(servers);

export const getElectrumServerPreference = (): ElectrumServerPreference => ({
  ...activePreference,
});

export const getConfiguredElectrumServerUrl = (): string => {
  if (activePreference.mode === 'recovery') return '';
  if (activePreference.mode === 'custom') return activePreference.customServerUrl;
  const officialServer = NITO_ELECTRUM_SERVERS[0];
  return officialServer ? formatElectrumServerUrl(officialServer) : '';
};

export const loadElectrumServerPreference = async (): Promise<ElectrumServerPreference> => {
  try {
    const saved = await SecureStore.getItemAsync(ELECTRUM_SERVER_PREFERENCE_KEY);
    if (saved === null) {
      activePreference = officialPreference();
      return getElectrumServerPreference();
    }

    try {
      const server = parseCustomElectrumServerUrl(saved);
      activePreference = customPreference(formatElectrumServerUrl(server));
    } catch (caught) {
      reportNonFinancialFailure('electrum server preference validation', caught);
      activePreference = recoveryPreference(
        'Saved Electrum server configuration is invalid. Open Settings to restore official servers.',
      );
    }
  } catch (caught) {
    reportNonFinancialFailure('electrum server preference read', caught);
    activePreference = recoveryPreference(
      'Electrum server configuration could not be read. Open Settings to restore official servers.',
    );
  }

  return getElectrumServerPreference();
};

export const createElectrumClient = (): NitoElectrumClient => {
  if (activePreference.mode === 'recovery') {
    throw new Error(activePreference.error);
  }

  const servers = activePreference.mode === 'custom'
    ? [parseCustomElectrumServerUrl(activePreference.customServerUrl)]
    : undefined;
  return instantiateElectrumClient(servers);
};

const verifyCustomElectrumServer = async (server: ElectrumServer): Promise<void> => {
  const client = instantiateElectrumClient([server]);
  try {
    await client.connect();
  } finally {
    client.disconnect();
  }
};

export const saveCustomElectrumServerPreference = async (
  input: string,
  invalidateBeforeActivation: () => void = () => undefined,
): Promise<ElectrumServerPreference> => {
  const server = parseCustomElectrumServerUrl(input);
  const customServerUrl = formatElectrumServerUrl(server);
  await verifyCustomElectrumServer(server);
  try {
    await SecureStore.setItemAsync(ELECTRUM_SERVER_PREFERENCE_KEY, customServerUrl);
  } catch (caught) {
    reportNonFinancialFailure('electrum server preference write', caught);
    throw caught;
  }
  invalidateBeforeActivation();
  activePreference = customPreference(customServerUrl);
  return getElectrumServerPreference();
};

export const restoreOfficialElectrumServers = async (
  invalidateBeforeActivation: () => void = () => undefined,
): Promise<ElectrumServerPreference> => {
  try {
    await SecureStore.deleteItemAsync(ELECTRUM_SERVER_PREFERENCE_KEY);
  } catch (caught) {
    reportNonFinancialFailure('electrum server preference delete', caught);
    throw caught;
  }
  invalidateBeforeActivation();
  activePreference = officialPreference();
  return getElectrumServerPreference();
};
