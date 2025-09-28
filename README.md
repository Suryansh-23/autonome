
# Autonome 🦾

<div align="center">
   <img src="https://img.shields.io/badge/powered%20by-ENS-4E5EE4" alt="ENS">
   <img src="https://img.shields.io/badge/payments-x402-black" alt="x402">
   <img src="https://img.shields.io/badge/Hypergraph-The%20Graph-4CAF50" alt="The Graph">
   <img src="https://img.shields.io/badge/deployed%20on-Polygon-6F36BC" alt="Polygon">
   <img src="https://img.shields.io/badge/wallet-Porto-orange" alt="Porto">
</div>

<br />

Autonome is a project that proposes a concrete, end-to-end approach for ethical AI agent access to web content. It combines payment enforcement (HTTP 402), decentralized identity (ENS), and automated verification (Chainlink) to enable a permissioned, compensated, and scalable agentic web.

## Problem Statement

The emergence of autonomous agents has intensified the tension between content access and fair compensation. The Perplexity–Cloudflare dispute (August 2025) exemplified systemic issues:

- Lack of verifiable agent identity and provenance when accessing content.
- Absence of standardized, enforceable payment mechanisms for web resources.
- Operational opacity around compliance with site policies and verification.
- Difficulty scaling trust, payments, and enforcement across heterogeneous web infrastructure.

These gaps harm content providers (uncompensated usage), agents (blocked or throttled access), and platforms (fragmented, ad hoc controls).

## Proposed Solution

Autonome delivers a modular reference stack:

1. Payment-Gated Access (x402)
    - A middleware SDK that implements HTTP 402 Payment Required, allowing sites to declare price, accepted assets, and verification rules.
    - Agents automatically discover, create, and attach payment headers to requests.
   - Integrates with an x402 facilitator (e.g., https://facilitator.x402.rs/) to verify signed payments per request and settle upon success.

2. Decentralized Identity & Registry (ENS + L2)
    - Smart contracts provide agent and provider identities anchored in ENS subnames.
    - A Registrar contract manages domain verification and issues on-chain attestations.
    - Layer-2 deployment for throughput and cost efficiency.

3. Automated Verification (Chainlink)
    - Chainlink Functions validates domain ownership (e.g., via DNS/HTTP proofs).
    - Chainlink Automation enforces ongoing verification and policy compliance.

4. Developer Tooling and UX
    - A CLI agent (Gemini-based) integrated with x402-fetch, wallet infra, and The Graph for knowledge overlays.
    - Two UIs: a provider onboarding app (Autonome) and a demo consumer site (HeySuri) that adopts the SDK.
   - Wallet infrastructure: Porto for agent-side signing and session management.

Outcome: Providers receive provable payment, agents expose verifiable identities, and the web becomes a programmable, enforceable market for content access.

5. Network & Indexing Layers (Polygon + Hypergraph)
   - Polygon mainnet: settlement and registry updates happen on Polygon for low fees and high throughput.
   - Hypergraph (The Graph): ontological indexing for public discovery; supports search, provenance, and reputation while keeping private data separate.

## Major Components

### 1) Middleware SDK (x402) — `sdk/express/`
- Implements HTTP 402 negotiation, pricing discovery, and header signing.
- Works with multiple EVM chains; supports wallet orchestration and auto network switching.
- Provides a drop-in server middleware for websites and a client library for agents/browsers.

Key capabilities:
- Micro-payments per request; retries with proof-of-payment.
- Pluggable verification and receipt checking; facilitator hooks.
 - Default facilitator: https://facilitator.x402.rs/ (configurable; self-hosting supported).

### 2) Smart Contracts — `contracts/`
Protocols for decentralized agent identity and domain verification on L2:

- ENS Integration (focus)
   - Subname strategy: each provider or agent can receive an ENS subname (e.g., `agent.domain.eth`, `provider.domain.eth`).
   - Resolves on-chain credentials for agents/providers (keys, metadata, payment endpoints).
   - Use cases:
      - Addressable Agent Identity: route requests/payments to a stable ENS name.
      - Scoped Capabilities: grant/revoke subnames for specific roles or services.
      - Audit & Traceability: event logs provide transparent operations.

- Chainlink Functions
   - Automated domain verification by fetching proofs from the web (DNS/HTTP).

- Layer-2 Registry
   - Lower fees and higher throughput for identity writes and verification events.

- Chainlink Automation
   - Periodic re-verification and policy checks; reduces manual ops.

Registrar highlights:
- `requestRegistration(fullDomain)` to initiate verification.
- Emits `DomainRegistered(fullDomain, owner)` upon success.
- Public view methods: `available`, `getRegistration`, etc.

### 3) Gemini CLI Agent — `gemini-cli/`
- Based on the open-source Gemini CLI, extended to:
   - Integrate `x402-fetch` for paid content retrieval.
   - Use Porto wallet infrastructure for transaction signing and session management.
   - Query Hypergraph (The Graph) as a knowledge layer and for registry lookups.
- Supports sandboxed execution, MCP tools, and large context windows for complex tasks.

### 4) Web UIs — `ui/`
- `ui/heysuri/` (Consumer Demo): a sample website that integrates the x402 middleware from the SDK to gate premium content.
- `ui/autonome/` (Provider Onboarding): allows providers to register their website URL, verifies ownership on-chain, and exposes success/error states based on the `DomainRegistered` event. Uses RainbowKit, wagmi, and viem for wallet connectivity.

## Deployed Contracts — Polygon Mainnet

- Network: Polygon PoS Mainnet (chainId: 137)
- Registrar: — https://polygonscan.com/address/0x2B0B924d46adbcbEE6dc8649a9F89068dcB2e393

## Architecture Overview

High-level flow (human vs. agent):

1) Human visitors (browser)
- Default UX remains free and familiar. Sites integrate the middleware on selected routes (e.g., API endpoints, data exports, or agent-only paths). Public pages, regular navigation, and standard content remain accessible without payment.
- Why no payment for humans: the middleware is configurable. Providers typically:
   - Allow-list human-facing routes (HTML/CSS/JS, basic content pages) so they bypass x402; or
   - Gate only premium/automated usage (e.g., scraping endpoints, bulk data, LLM-tailored APIs).
- The middleware checks request context (route, headers, optional user-agent hints) and only challenges when the endpoint is priced. Human users browsing normal pages won’t see a 402 payment challenge.

2) Autonomous agents (e.g., Gemini CLI)
- When an agent requests a priced/agent-marked endpoint, the middleware responds with HTTP 402, including pricing, accepted assets, and verification parameters.
- The agent (via `x402-fetch`) automatically constructs a signed payment payload and retries the request with the payment header attached.
- An x402 facilitator (e.g., https://facilitator.x402.rs/) verifies the payment, forwards the request upstream, and settles funds on success. This is stateless, per-request, and doesn’t require accounts or sessions.

3) Identity and verification
- Providers onboard through the Autonome UI and register their website URL. The Registrar + Chainlink Functions verify domain ownership and maintain attestations on an L2 registry.
- ENS subnames can be used to publish agent/provider identities and payment endpoints, enabling consistent addressing and provenance across services.

## Networks & Integrations

### ENS on L2: Subname Registry for Partner Discovery
- Goal: create a registry of integrated partner websites using ENS subnames on an L2, improving discovery and providing a canonical, verifiable identity for each partner.
- Structure: we issue hierarchical subnames derived from the website domain, separating top-level domains (TLDs) and lower-level domains for clarity and governance. Example: a site like `heysuri.xyz` is represented as `heysuri.xyz.atnom.eth`, where `xyz.atnom.eth` maps TLD space and `heysuri.xyz.atnom.eth` denotes the concrete partner.
- Implementation details:
   - Durin-based integration for ENS-compatible resolution tooling.
   - Custom L2 Registrar with logic to authenticate website ownership via Chainlink Functions before subname issuance.
   - On success, Registrar records the verified mapping on-chain and emits events for indexing and provenance.

### Polygon: Mainnet Deployment and Stable Payments over HTTP
- Deployment: Autonome is deployed on Polygon mainnet to keep registry writes and verification events cost-efficient.
- Payments: agents can pay website owners in stables on Polygon using the x402 HTTP flow. The middleware gates priced endpoints, and an x402 facilitator (e.g., https://facilitator.x402.rs/) verifies and settles payments per request.
- Contract addresses (Polygon):
   - Registrar: [TBD]
   - Registry/Resolver (if applicable): [TBD]

### Hypergraph: Ontological Data with Public Discovery and Private Separation
- Public discovery: publish minimal, ontologically structured metadata to enable indexing, search, and reputation (e.g., verified domains, issuance events, ENS subnames).
- Private separation: sensitive provider details, operational secrets, or policy internals are kept off-chain/off-index and surfaced via controlled interfaces.

### Chainlink Functions and Automation
- Chainlink Functions: used to validate website ownership (DNS/HTTP proofs) as part of the Registrar flow prior to ENS subname issuance.
- Chainlink Automation: used for periodic re-verification and policy checks to maintain integrity over time.

## Repository Structure (selected)

- `contracts/` — Registrar and related contracts (ENS, Chainlink).
- `sdk/express/` — Core HTTP 402 middleware SDK.
- `x402-fetch/` — Fetch client with x402 support for agents.
- `gemini-cli/` — CLI agent with x402, wallet, and Hypergraph integration.
- `ui/heysuri/` — Demo consumer site using the SDK.
- `ui/autonome/` — Provider onboarding app (URL registration & verification).


## Contributing

Contributions are welcome. Please open an issue to discuss significant changes. For quick fixes, submit a PR with a clear description and minimal scope.

## License

MIT — see [LICENSE](LICENSE).
