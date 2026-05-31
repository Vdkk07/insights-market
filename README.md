# Insights Market 📊

> AI-Powered Decentralized Prediction Markets on Solana

Insights Market is a fully on-chain prediction market platform built on Solana. An AI bot powered by Groq LLaMA 3.3 automatically generates market questions, manages liquidity, and resolves outcomes. Users connect their Solana wallet, trade YES/NO shares through an on-chain AMM, and claim winnings — all without any custodian.

**Solana India Fellowship 2025 — Capstone Submission**

---

## Live Demo

[https://insights-market-capstone.vercel.app](https://insights-market-capstone.vercel.app)

---

## Demo Video

[https://www.loom.com/share/0e2eaba1fd104fcf891e4ad550c89e2d](https://www.loom.com/share/0e2eaba1fd104fcf891e4ad550c89e2d)

---

## Program ID

8M1BMJ2Z9t8239ZsKnY9yF2UAAJEAsGG9wgAFigGZtu8

---

## 💡 What It Does

Users browse AI-generated prediction markets, buy YES or NO shares with SOL, watch prices shift in real time, and collect winnings once the AI resolves the outcome. Every trade is an on-chain transaction. There is no order book — prices are determined by a constant-product AMM running inside the Solana smart contract.

The backend Python bot runs autonomously:

- Calls Groq every 15 minutes to generate a unique market question
- Checks MongoDB to avoid duplicating recent questions
- Creates the market on-chain with 0.1 SOL of initial liquidity on each side
- After 30 minutes, calls Groq again to reason about the outcome
- Sends a `resolve_market` transaction on-chain
- Indexes all `BuyShares` events via Helius into MongoDB for the price chart

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                   User / Wallet                      │
└────────────────────────┬────────────────────────────┘
                         │  wallet txs
┌────────────────────────▼────────────────────────────┐
│              Next.js 15 Frontend (Vercel)            │
│  Reads Anchor PDAs directly via Solana RPC           │
│  /api/history/[marketPubkey] → MongoDB               │
└──────────┬─────────────────────────┬────────────────┘
           │ RPC                     │ Mongo
┌──────────▼──────────┐  ┌──────────▼──────────────┐
│  Solana Devnet       │  │  MongoDB Atlas           │
│  Anchor Program      │  │  markets + market_history│
│  PDAs: config        │  └─────────────────────────┘
│        market                      ▲
│        vault          ┌────────────┴────────────────┐
│        fee_vault      │  Python Bot (Railway)        │
│        user_position  │  Groq → create/resolve txs  │
└──────────────────────┘  │  Helius → event indexing   │
                          └─────────────────────────────┘
```

---

## 📜 Smart Contract

**Program ID:** `8M1BMJ2Z9t8239ZsKnY9yF2UAAJEAsGG9wgAFigGZtu8`

**Network:** Solana Devnet

Built with Anchor. Six instructions:

| Instruction | What it does |
|---|---|
| `initialize` | Creates the protocol `config` PDA and `fee_vault` PDA |
| `create_market` | Deploys a new market with initial AMM liquidity |
| `buy_shares` | User pays SOL → fee deducted → AMM updates → `user_position` updated → event emitted |
| `resolve_market` | Authority sets the winning outcome after expiry |
| `claim_winnings` | Winning user receives proportional share of vault |
| `withdraw_fees` | Authority withdraws accumulated protocol fees |

### AMM Mechanics

Prices come from a constant-product formula `x * y = k`:

```
YES Price = yes_liquidity / (yes_liquidity + no_liquidity)
NO  Price = 1 − YES Price

Buying YES shares:
  new_yes    = yes_liquidity + sol_in
  new_no     = k / new_yes
  shares_out = yes_liquidity − new_no
```

### Fee Structure

- Trading fee: 2% (200 basis points)
- Initial liquidity per side: 0.1 SOL
- Market duration: 30 minutes

### Key Account Structures

```rust
pub struct Config {
    pub authority: Pubkey,
    pub market_count: u64,
    pub fee_percentage: u16,   // 200 = 2%
    pub bump: u8,
    pub fee_vault_bump: u8,
}

pub struct Market {
    pub market_id: u64,
    pub question: String,      // max 200 chars
    pub description: String,   // max 1000 chars
    pub category: String,      // max 50 chars
    pub yes_liquidity: u64,
    pub no_liquidity: u64,
    pub k_constant: u128,
    pub total_volume: u64,
    pub resolved: bool,
    pub outcome: Option<bool>,
}

pub struct UserPosition {
    pub user: Pubkey,
    pub market_id: u64,
    pub yes_shares: u64,
    pub no_shares: u64,
    pub claimed: bool,
    pub bump: u8,
}
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Smart Contract | Rust, Anchor 0.32 |
| Frontend | Next.js 15, TypeScript, Tailwind CSS, shadcn/ui |
| Wallet | Solana Wallet Adapter (Phantom, Solflare, Backpack) |
| Data Fetching | React Query |
| Charts | Recharts |
| Backend Bot | Python 3.11+, Groq SDK, solders, solana-py |
| Database | MongoDB Atlas |
| RPC / Indexing | Helius |
| AI | Groq LLaMA 3.3 |
| Frontend Hosting | Vercel |
| Bot Hosting | Railway |

---

## 📁 Repository Structure

```
insights/
├── app/                          # Next.js 15 frontend
│   └── src/
│       ├── app/
│       │   ├── api/history/      # MongoDB history API route
│       │   ├── markets/[id]/     # Market detail page
│       │   └── positions/        # User positions page
│       ├── components/
│       │   └── prediction-market/
│       └── lib/
│           ├── prediction-market-data-access.tsx
│           ├── prediction-market-program.ts
│           └── idl.json          # Anchor IDL
├── programs/capstone2/
│   └── src/lib.rs                # Anchor smart contract
├── backend/
│   ├── main.py                   # AI bot + event indexer
│   └── withdraw.py               # Fee withdrawal utility
├── tests/                        # Anchor integration tests
├── migrations/                   # Anchor deploy hook
├── runbooks/                     # Deployment runbook
├── Anchor.toml
├── Cargo.toml
└── rust-toolchain.toml
```

---

## 🚀 Local Setup

### Prerequisites

| Tool | Required Version |
|---|---|
| Node.js | 20 LTS or 22 LTS |
| Rust | 1.89.0 (pinned via `rust-toolchain.toml`) |
| Solana CLI | 1.18+ |
| Anchor CLI | 0.32.x |
| MongoDB | 6.0+ |
| Python | 3.11+ |

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/insights.git
cd insights
```

### 2. Frontend

```bash
cd app
npm ci
npm run dev        # opens at http://localhost:3000
```

### 3. Smart contract (local)

```bash
# In project root
yarn install                                        # installs test deps
solana-test-validator                               # start local validator
anchor build
anchor deploy --provider.cluster localnet
anchor test --skip-build --skip-deploy              # run integration tests
```

### 4. Backend bot

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install groq python-dotenv pymongo solders solana requests base58
cp .env.example .env        # fill in your keys
python main.py
```

### 5. Environment variables

**Backend (`backend/.env`):**

```env
SOLANA_RPC_URL=https://api.devnet.solana.com/
MONGO_URI=<MongoDB Atlas Connection String>
GROQ_API_KEY=your_groq_api_key
HELIUS_API_KEY=your_helius_api_key
HELIUS_ENDPOINT=https://api-devnet.helius-rpc.com/
PRIVATE_KEY_BYTES=[your,64,byte,authority,secret,key]
```

**Frontend (`app/.env.local`):**

```env
NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com/
MONGO_URI=<MongoDB Atlas Connection String>
```

> `MONGO_URI` is needed by the frontend because the `/api/history` route reads trade history directly from MongoDB.

---

## ☁️ Deployment

### Solana Program (Devnet)

```bash
# Fund the authority wallet
solana airdrop 2 --url devnet

anchor build
anchor deploy --provider.cluster devnet

# Initialize the protocol (runs once automatically on first bot start)
python backend/main.py
```

### Frontend — Vercel

1. Connect the `app/` directory to a Vercel project
2. Add `NEXT_PUBLIC_SOLANA_RPC` and `MONGO_URI` to Vercel environment variables
3. Deploy

### Backend Bot — Railway

1. Create a new Railway service pointing to `backend/`
2. Add all variables from `backend/.env` as Railway environment variables
3. Set start command: `python main.py`

### Database — MongoDB Atlas

1. Create a free Atlas cluster
2. Whitelist Railway and Vercel outbound IPs
3. Update `MONGO_URI` in both Vercel and Railway

---

## 📡 API Reference

### `GET /api/history/[marketPubkey]`

Returns trade history for a market, used to render the price chart.

```json
[
  {
    "yes_liquidity": "100000000",
    "no_liquidity": "100000000",
    "timestamp": "2025-05-31T10:30:00Z",
    "is_yes": true,
    "shares": "5000000",
    "tx_signature": "5xQ7..."
  }
]
```

---

## 🔐 Security

- All market resolutions require the authority keypair signature
- PDA derivation prevents unauthorized account creation or tampering
- Checked arithmetic throughout the contract prevents integer overflow
- Fee vault is a separate PDA — protocol fees cannot be mixed with market liquidity
- Users can only claim winnings once (`claimed` flag on `UserPosition`)

---

## 🧪 Testing

```bash
# From project root
yarn install
anchor test
```

The integration tests cover market creation, share purchases, resolution, claiming winnings, and fee withdrawal.

---

## 🛠️ Troubleshooting

**Markets not showing on frontend**
- Confirm the program is deployed and the program ID in `idl.json` matches `Anchor.toml`
- Check that your wallet is set to Devnet

**Bot not creating markets**
- Verify `GROQ_API_KEY` is valid and has credits remaining
- Confirm MongoDB Atlas is reachable and MONGO_URI is configured correctly
- Ensure the authority wallet has at least 0.5 SOL (for liquidity + rent)

**`ModuleNotFoundError` when running the backend**
- Activate the virtual environment first: `source venv/bin/activate`

**`Bus error` on `npm run dev`**
- Use Node 20 or 22 LTS — the Next.js SWC binary has known issues with Node 24 on some Linux systems

---

## 🙏 Acknowledgements

- [Anchor Framework](https://www.anchor-lang.com/)
- [Solana Web3.js](https://solana-labs.github.io/solana-web3.js/)
- [Groq](https://groq.com/) — LLaMA 3.3 inference
- [Helius](https://helius.dev/) — RPC and event parsing
- [shadcn/ui](https://ui.shadcn.com/)
- [Solana India Fellowship](https://superteam.fun/india) — for the opportunity

---

**Built on Solana** | Solana India Fellowship Capstone 2025