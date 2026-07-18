# Privacy

Nito Wallet does not require an account, email address or custodial service.
The recovery phrase and private keys are encrypted and stored on the device.
They are not sent to Nito network services.

## Network data

The application connects to Nito network infrastructure to discover addresses,
balances, unspent outputs, transaction history and new blocks, and to broadcast
signed transactions. Those services can observe normal connection metadata,
including the source IP address and requested public blockchain data.

Opening a transaction in the explorer sends the transaction identifier to the
device browser. QR scanning uses the device camera only while the scanner is
open. Copying an address places public data on the system clipboard.

## Local data

Wallet metadata, synchronization checkpoints and optional reconstructed history
are stored locally. Removing the wallet from the application deletes its local
vault and cached metadata but does not erase the public blockchain.

The application does not include advertising or behavioral analytics.

Privacy questions may be sent to contact@nito.network.
