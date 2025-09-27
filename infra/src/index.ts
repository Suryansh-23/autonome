import cors from "cors";
import "dotenv/config";
import express, { Request, Response} from "express";
import { Route, Router } from "porto/server";
import { 
    PaymentRequirementsSchema, 
    type PaymentRequirements, 
    type PaymentPayload, 
    PaymentPayloadSchema, 
    createConnectedClient, 
    createSigner, 
    SupportedEVMNetworks, 
    Signer, 
    ConnectedClient, 
    SupportedPaymentKind } from "x402/types"
import { verify, settle } from "x402/facilitator"
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, Hex, http, SendTransactionParameters } from "viem";
import { baseSepolia, polygon } from "viem/chains";

const EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY || ""
const EVM_ADDRESS = process.env.EVM_ADDRESS || ""
const chainIdToChain = { 
  84532: baseSepolia,
  137: polygon,
}

if (!EVM_PRIVATE_KEY || !EVM_ADDRESS) {
    console.error("Missing required environment variables")
    process.exit(1)
}

const app = express();
app.use(cors());
app.use(express.json());

// Endpoints for Facilitator Server
type VerifyRequest = {
    paymentPayload: PaymentPayload;
    paymentRequirements: PaymentRequirements;
};

type SettleRequest = {
    paymentPayload: PaymentPayload;
    paymentRequirements: PaymentRequirements;
}

app.post("/verify", async (req: Request, res: Response) => {
  try {
    const body: VerifyRequest = req.body;
    const paymentRequirements = PaymentRequirementsSchema.parse(body.paymentRequirements);
    const paymentPayload = PaymentPayloadSchema.parse(body.paymentPayload);

    // use the correct client/signer based on the requested network
    // svm verify requires a Signer because it signs & simulates the txn
    let client: Signer | ConnectedClient;
    if (SupportedEVMNetworks.includes(paymentRequirements.network)) {
      client = createConnectedClient(paymentRequirements.network);
    } else {
      throw new Error("Invalid network");
    }

    const valid = await verify(client, paymentPayload, paymentRequirements);
    res.json(valid);

  } catch (error) {
    console.error("error", error);
    res.status(400).json({ error: "Invalid request" });
  }
});

app.get("/settle", (_req: Request, res: Response) => {
  res.json({
    endpoint: "/settle",
    description: "POST to settle x402 payments",
    body: {
      paymentPayload: "PaymentPayload",
      paymentRequirements: "PaymentRequirements",
    },
  });
});

app.get("/supported", async (_req: Request, res: Response) => {
  let kinds: SupportedPaymentKind[] = [];

  // evm
  if (EVM_PRIVATE_KEY) {
    kinds.push({
      x402Version: 1,
      scheme: "exact",
      network: "base-sepolia",
    });
  }

  res.json({
    kinds,
  });
});

app.post("/settle", async (req: Request, res: Response) => {
  try {
    const body: SettleRequest = req.body;
    const paymentRequirements = PaymentRequirementsSchema.parse(body.paymentRequirements);
    const paymentPayload = PaymentPayloadSchema.parse(body.paymentPayload);
    console.log("Received settle request (facilitator settle endpoint) for network:", paymentRequirements.network);

    // use the correct private key based on the requested network
    let signer: Signer;
    if (SupportedEVMNetworks.includes(paymentRequirements.network)) {
      signer = await createSigner(paymentRequirements.network, EVM_PRIVATE_KEY);
    } else {
      throw new Error("Invalid network");
    }

    const response = await settle(signer, paymentPayload, paymentRequirements);
    res.json(response);
    
  } catch (error) {
    console.error("error", error);
    res.status(400).json({ error: `Invalid request: ${error}` });
  }
});

app.post("/paymaster", async (req: Request, res: Response) => {
  
  const { to, data, chainId }= req.body
  const chain = chainIdToChain[chainId as keyof typeof chainIdToChain];

  const walletClient = createWalletClient({
    chain,
    account: privateKeyToAccount(EVM_PRIVATE_KEY as Hex),
    transport: http()
  })
  console.log(`Received paymaster request for chainId: ${chainId}, to: ${to}`);
  console.log(`created wallet client using private key, account: ${walletClient.account.address}`)
  try {
    const txnPayload: SendTransactionParameters = {
      account: EVM_ADDRESS as Hex,
      to: to as Hex,
      data: data as Hex, 
      chain, 
    }
    // console.log(`txnpayload created this ${txnPayload}`)
    const hash = await walletClient.sendTransaction(txnPayload);
    console.log(`[infra server] transaction sent, hash: ${hash}`);
    res.status(200).json({ hash });
  } catch (e) {
    res.status(500).json({ error: `Transaction failed: ${e}` });
  }
})

/*
// Endpoints for Porto Merchant Server
const porto = Router({ basePath: "/porto" }).route(
  "/merchant",
  Route.merchant({
    address: EVM_ADDRESS as `0x${string}`,
    key: EVM_PRIVATE_KEY as `0x${string}`,
    sponsor: true,
  })
);
app.use(porto.listener);
*/

app.listen(process.env.PORT, () => {
  console.log(`Infra server (facilitator + porto merchant) running on port ${process.env.PORT}`);
});
