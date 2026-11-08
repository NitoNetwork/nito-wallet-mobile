# Privacy

Last updated: November 8, 2026

Nito Wallet does not require an account, email address or custodial service.
The recovery phrase, optional BIP39 passphrase and private keys are encrypted
and stored on the device. They are not sent to Nito network services.

## Network data

The application connects over encrypted TLS connections using `wss://` to
official or user-selected ElectrumX servers. These servers receive public
blockchain queries used to discover addresses, balances, unspent outputs,
transaction history and new blocks, and to broadcast signed transactions. The
server operators can observe normal connection metadata, including the source
IP address and requested public blockchain data. Infrastructure operators may
retain routine security logs according to their operational policies.

Opening a transaction in the explorer sends the transaction identifier to the
device browser over HTTPS. The selected explorer operator receives that public
identifier and normal connection metadata. Copying or sharing an address sends
public data to the operating system clipboard or sharing facility.

QR scanning uses the device camera only while the scanner is open. QR images
are processed on the device and are not stored or uploaded by Nito Wallet.

Optional biometric authentication is performed by Android or iOS. Nito Wallet
does not receive or store fingerprints, facial images or biometric templates.

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

Local data remains on the device until the wallet is removed from the
application or the application is uninstalled. Nito Wallet does not create a
server-side account, so there is no remote account or server-side wallet record
to delete.

An optional BIP39 passphrase creates a different wallet from the same recovery
phrase. It is not an extra recovery word and cannot be recovered if forgotten.
Back it up exactly and separately from the recovery phrase.

Issued HD address indices, signed transactions awaiting broadcast and their
tracking status are also stored locally so interrupted sends can resume. This
history database contains no recovery phrase or private key.

The application blocks screen capture while recovery words are visible. On iOS,
those phrase displays are also protected in application-switcher previews.

Copying a recovery phrase requires confirmation of a clipboard warning. Other
applications may read the clipboard, and device settings may synchronize it.
Hiding the phrase does not clear the clipboard. Clear it after use.

The application does not include advertising or behavioral analytics.

Privacy questions may be sent to help@nito.network.
