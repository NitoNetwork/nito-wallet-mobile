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

## Network trust model

Nito Wallet is a lightweight client. Balances, unspent outputs and history are
reported by the ElectrumX servers it connects to and are not independently
verified with block Merkle proofs (no full SPV verification). A malicious or
compromised server could therefore misreport balances or the result of a
broadcast. In official-server mode, the wallet can connect to more than one
configured Nito ElectrumX server. In custom-server mode, it connects only to the
selected server and does not automatically fall back to official servers. That
custom server can associate every wallet address queried by the application
with the same source IP address. Users who require full verification should run
and connect to their own trusted node.

## Local data

Wallet metadata, synchronization checkpoints and optional reconstructed history
are stored locally. Removing the wallet from the application deletes its local
vault and cached metadata but does not erase the public blockchain.

Issued HD address indices, signed transactions awaiting broadcast and their
tracking status are also stored locally so interrupted sends can resume. This
history database contains no recovery phrase or private key.

The application blocks screen capture while recovery words are visible. On iOS,
those phrase displays are also protected in application-switcher previews.

The application does not include advertising or behavioral analytics.

Privacy questions may be sent to help@nito.network.
