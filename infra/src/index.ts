import cors from "cors";
import "dotenv/config";
import express, { Request, Response } from "express";
import {
  Address,
  createPublicClient,
  createWalletClient,
  EncodeFunctionDataParameters,
  Hex,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, polygon } from "viem/chains";
import { settle, verify } from "x402/facilitator";
import {
  ConnectedClient,
  createConnectedClient,
  createSigner,
  PaymentPayloadSchema,
  PaymentRequirementsSchema,
  Signer,
  SupportedEVMNetworks,
  SupportedPaymentKind,
  type PaymentPayload,
  type PaymentRequirements,
} from "x402/types";

const EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY || "";
const EVM_ADDRESS = process.env.EVM_ADDRESS || "";
const chainIdToChain = {
  84532: baseSepolia,
  137: polygon,
};
const chainIdToRPC = {
  84532: process.env.BASE_SEPOLIA_RPC_URL || "",
  137: process.env.POLYGON_RPC_URL || "",
};
const chainIdToAddress = {
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  137: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
};

const transferAbi = parseAbi([
  "function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes memory signature)",
]);

if (!EVM_PRIVATE_KEY || !EVM_ADDRESS) {
  console.error("Missing required environment variables");
  process.exit(1);
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
};

app.post("/verify", async (req: Request, res: Response) => {
  try {
    const body: VerifyRequest = req.body;
    const paymentRequirements = PaymentRequirementsSchema.parse(
      body.paymentRequirements
    );
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
    const paymentRequirements = PaymentRequirementsSchema.parse(
      body.paymentRequirements
    );
    const paymentPayload = PaymentPayloadSchema.parse(body.paymentPayload);
    console.log(
      "Received settle request (facilitator settle endpoint) for network:",
      paymentRequirements.network
    );

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
  try {
    const request: Omit<
      EncodeFunctionDataParameters<
        typeof transferAbi,
        "transferWithAuthorization"
      >,
      "abi" | "functionName"
    > & {
      chainId: number;
    } = req.body;

    const chain =
      chainIdToChain[request.chainId as keyof typeof chainIdToChain];

    const walletClient = createWalletClient({
      chain,
      account: privateKeyToAccount(EVM_PRIVATE_KEY as Hex),
      transport: http(
        chainIdToRPC[request.chainId as keyof typeof chainIdToRPC]
      ),
    });
    const publicClient = createPublicClient({
      chain,
      transport: http(
        chainIdToRPC[request.chainId as keyof typeof chainIdToRPC]
      ),
    });

    console.log(
      "using rpc",
      chainIdToRPC[request.chainId as keyof typeof chainIdToRPC]
    );
    

    console.log(
      `Received paymaster request for chainId: ${request.chainId}, to: ${request.args[1]}`
    );
    console.log(
      `created wallet client using private key, account: ${walletClient.account.address}`
    );
    try {
      console.log(
        `txnpayload created this ${JSON.stringify(
          request,
          (_, v) => (typeof v === "bigint" ? v.toString() : v),
          2
        )}`
      );
      const hash = await walletClient.writeContract({
        abi: transferAbi,
        address: chainIdToAddress[
          request.chainId as keyof typeof chainIdToAddress
        ] as Address,
        functionName: "transferWithAuthorization",
        args: request.args,
      });
      console.log(`[infra server] transaction sent, hash: ${hash}`);
      res.status(200).json({ hash });
    } catch (e) {
      console.error("Transaction error:", e);
      res.status(500).json({ error: `Transaction failed.` });
    }
  } catch (error) {
    console.error("error", error);
    res.status(500).json({ error: `Internal Server Error: ${error}` });
  }
});

app.listen(process.env.PORT, () => {
  console.log(
    `Infra server (facilitator + transfer paymaster) running on port http://localhost:${process.env.PORT}`
  );
});
