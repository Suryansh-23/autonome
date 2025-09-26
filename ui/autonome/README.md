## x0x0

A minimal protocol site and app built with Next.js, RainbowKit, wagmi v2, and viem.

### Getting Started

1. Set your WalletConnect project ID in `.env`:

```
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=YOUR_ID
```

2. Run the dev server:

```bash
npm run dev
```

Open http://localhost:3000 to see the landing page. Use the top-right “Launch App” to open the dapp.

### Files
- `app/page.tsx` — Landing page
- `app/app/page.tsx` — App page with wallet connect + register flow
- `app/app/RainbowProvider.tsx` — RainbowKit + wagmi provider
- `lib/contract.ts` — Placeholder ABI and addresses (replace later)

Replace the ABI and contract addresses once available. The register action calls `register(string url)` on the contract using viem.
