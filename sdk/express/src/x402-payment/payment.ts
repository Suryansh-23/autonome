import { NextFunction, Request, Response } from "express";
import { nextTick } from "process";
import { Address, getAddress } from "viem";
// import { Address as SolanaAddress } from "@solana/kit";
import { exact } from "x402/schemes";
import {
  computeRoutePatterns,
  findMatchingPaymentRequirements,
  findMatchingRoute,
  getPaywallHtml,
  processPriceToAtomicAmount,
  toJsonSafe,
} from "x402/shared";
import {
  FacilitatorConfig,
  ERC20TokenAmount,
  moneySchema,
  PaymentPayload,
  PaymentRequirements,
  PaywallConfig,
  Resource,
  RoutesConfig,
  settleResponseHeader,
  SupportedEVMNetworks,
  Price,
  Network
} from "x402/types";
import { useFacilitator } from "x402/verify";

/**
 * A function that computes a dynamic price based on the original price and request/network context.
 *
 * Implementations receive the pre-calculated `originalPrice` and may inspect the incoming HTTP
 * `Request` and the current `Network` context to produce a modified `Price` (for example by
 * applying discounts, taxes, or exchange-rate adjustments).
 *
 * Implementations should not mutate the provided `originalPrice`; instead they should return a
 * new `Price` value. The function is synchronous and may throw to indicate an error during
 * calculation.
 *
 * @param originalPrice - The price computed earlier in the pipeline that may be adjusted.
 * @param req - The incoming HTTP request (e.g. to read headers, cookies, query params, auth info).
 * @param network - Network/environment context (e.g. chain, region, currency settings).
 * @returns The resulting `Price` after applying dynamic adjustments.
 *
 * @example
 * const applyDiscount: DynamicPriceCalculator = (originalPrice, req, network) => {
 *   const discount = req.headers['x-discount'] ? parseFloat(String(req.headers['x-discount'])) : 0;
 *   return { ...originalPrice, amount: Math.max(0, originalPrice.amount * (1 - discount)) };
 * };
 */
export type DynamicPriceCalculator = (originalPrice: Price, req: Request, network: Network) => Price;

/**
 * Creates a payment middleware factory for Express
 *
 * @param payTo - The address to receive payments
 * @param routes - Configuration for protected routes and their payment requirements
 * @param facilitator - Optional configuration for the payment facilitator service
 * @param paywall - Optional configuration for the default paywall
 * @param dynamicPriceCalculator - Optional function to calculate dynamic pricing based on request
 * @returns An Express middleware handler
 */
export function paymentMiddleware(
  payTo: Address,
  routes: RoutesConfig,
  facilitator?: FacilitatorConfig,
  paywall?: PaywallConfig,
  dynamicPriceCalculator?: DynamicPriceCalculator,
) {
  const { verify, settle } = useFacilitator(facilitator);
  const x402Version = 1;

  // Pre-compile route patterns to regex and extract verbs
  const routePatterns = computeRoutePatterns(routes);

  return async function paymentMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const matchingRoute = findMatchingRoute(routePatterns, req.path, req.method.toUpperCase());

    if (!matchingRoute) {
      console.log(`[paymentMiddleware] endpoint called is not a part of the protected routes 🔫🔫🔫🔫🔫`);
      return next();
    }
    console.log(`[paymentMiddleware] endpoint called is a part of the protected routes, x402-payment required 🛡️🛡️🛡️🛡️🛡️`);
    let { price, network, config = {} } = matchingRoute.config;

    if (dynamicPriceCalculator) {
      console.log(`[paymentMiddleware] Dynamic pricing calculator found, calculating dynamic price`);
      // price = dynamicPriceCalculator(origniall
      const originalPrice = price;
      price = dynamicPriceCalculator(originalPrice, req, network);
      console.log(`[paymentMiddleware] Dynamic pricing: ${originalPrice} (default price from the route config) -> ${price} (adjusted as per the RPS)`);
    }
    const {
      description,
      mimeType,
      maxTimeoutSeconds,
      inputSchema,
      outputSchema,
      customPaywallHtml,
      resource,
      discoverable,
    } = config;

    const atomicAmountForAsset = processPriceToAtomicAmount(price, network);
    console.log(`[paymentMiddleware] Processed price ${price} on network ${network} to atomic amount`, atomicAmountForAsset);
    if ("error" in atomicAmountForAsset) {
      throw new Error(atomicAmountForAsset.error);
    }
    const { maxAmountRequired, asset } = atomicAmountForAsset;

    const resourceUrl: Resource =
      resource || (`${req.protocol}://${req.headers.host}${req.path}` as Resource);
    console.log(`[paymentMiddleware] Using resource URL: ${resourceUrl}`);
    let paymentRequirements: PaymentRequirements[] = [];

    if (SupportedEVMNetworks.includes(network)) {
      paymentRequirements.push({
        scheme: "exact",
        network,
        maxAmountRequired,
        resource: resourceUrl,
        description: description ?? "",
        mimeType: mimeType ?? "",
        payTo: getAddress(payTo),
        maxTimeoutSeconds: maxTimeoutSeconds ?? 60,
        asset: getAddress(asset.address),
        outputSchema: {
          input: {
            type: "http",
            method: req.method.toUpperCase(),
            discoverable: discoverable ?? true,
            ...inputSchema,
          },
          output: outputSchema,
        },
        extra: (asset as ERC20TokenAmount["asset"]).eip712,
      });
    } else {
      throw new Error(`Unsupported network: ${network}. Only EVM networks are supported.`);
    }

    const payment = req.header("X-PAYMENT");
    const userAgent = req.header("User-Agent") || "";
    const acceptHeader = req.header("Accept") || "";
    const isWebBrowser = acceptHeader.includes("text/html") && userAgent.includes("Mozilla");

    if (!payment) {
      console.warn(`[paymentMiddleware] x402-payment header missing from request ⚠️⚠️⚠️⚠️⚠️⚠️⚠️`);
      if (isWebBrowser) {
        let displayAmount: number;
        if (typeof price === "string" || typeof price === "number") {
          const parsed = moneySchema.safeParse(price);
          if (parsed.success) {
            displayAmount = parsed.data;
          } else {
            displayAmount = Number.NaN;
          }
        } else {
          displayAmount = Number(price.amount) / 10 ** price.asset.decimals;
        }

        const html =
          customPaywallHtml ||
          getPaywallHtml({
            amount: displayAmount,
            paymentRequirements: toJsonSafe(paymentRequirements) as Parameters<
              typeof getPaywallHtml
            >[0]["paymentRequirements"],
            currentUrl: req.originalUrl,
            testnet: network === "base-sepolia",
            cdpClientKey: paywall?.cdpClientKey,
            appName: paywall?.appName,
            appLogo: paywall?.appLogo,
            sessionTokenEndpoint: paywall?.sessionTokenEndpoint,
          });
        res.status(402).send(html);
        return;
      }
      res.status(402).json({
        x402Version,
        error: "X-PAYMENT header is required",
        accepts: toJsonSafe(paymentRequirements),
      });
      return;
    }

    let decodedPayment: PaymentPayload;
    try {
      decodedPayment = exact.evm.decodePayment(payment);
      decodedPayment.x402Version = x402Version;
    } catch (error) {
      console.error(error);
      res.status(402).json({
        x402Version,
        error: error || "Invalid or malformed payment header",
        accepts: toJsonSafe(paymentRequirements),
      });
      return;
    }

    const selectedPaymentRequirements = findMatchingPaymentRequirements(
      paymentRequirements,
      decodedPayment,
    );
    if (!selectedPaymentRequirements) {
      res.status(402).json({
        x402Version,
        error: "Unable to find matching payment requirements",
        accepts: toJsonSafe(paymentRequirements),
      });
      return;
    }

    try {
      console.log(`[paymentMiddleware] Verifying payment with facilitator`);
      const response = await verify(decodedPayment, selectedPaymentRequirements);
      console.log(`[paymentMiddleware] Verify response from facilitator:`, response.isValid);
      if (!response.isValid) {
        res.status(402).json({
          x402Version,
          error: response.invalidReason,
          accepts: toJsonSafe(paymentRequirements),
          payer: response.payer,
        });
        return;
      }
    } catch (error) {
      console.error(error);
      res.status(402).json({
        x402Version,
        error,
        accepts: toJsonSafe(paymentRequirements),
      });
      return;
    }

    /* eslint-disable @typescript-eslint/no-explicit-any */
    type EndArgs =
      | [cb?: () => void]
      | [chunk: any, cb?: () => void]
      | [chunk: any, encoding: BufferEncoding, cb?: () => void];
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const originalEnd = res.end.bind(res);
    let endArgs: EndArgs | null = null;

    res.end = function (...args: EndArgs) {
      endArgs = args;
      return res; // maintain correct return type
    };

    // Proceed to the next middleware or route handler
    // await next();

    // If the response from the protected route is >= 400, do not settle payment
    if (res.statusCode >= 400) {
      res.end = originalEnd;
      if (endArgs) {
        originalEnd(...(endArgs as Parameters<typeof res.end>));
      }
      return;
    }

    try {
      console.log(`[paymentMiddleware] Settling payment with facilitator`);
      const settleResponse = await settle(decodedPayment, selectedPaymentRequirements);
      console.log(`[paymentMiddleware] Settle response from facilitator:`, settleResponse);
      const responseHeader = settleResponseHeader(settleResponse);
      // console.log(`[paymentMiddleware] Setting X-PAYMENT-RESPONSE header:`, responseHeader);
      
      if (!res.headersSent) {
        res.setHeader("X-PAYMENT-RESPONSE", responseHeader);
        console.log(`[paymentMiddleware] Successfully set X-PAYMENT-RESPONSE header, then calling next()`);
        await next();
      } else {
        console.warn(`[paymentMiddleware] Headers already sent, cannot set X-PAYMENT-RESPONSE header⚠️⚠️⚠️`);
      }

      // if the settle fails, return an error
      if (!settleResponse.success) {
        res.status(402).json({
          x402Version,
          error: settleResponse.errorReason,
          accepts: toJsonSafe(paymentRequirements),
        });
        return;
      }
    } catch (error) {
      console.error(error);
      // If settlement fails and the response hasn't been sent yet, return an error
      if (!res.headersSent) {
        res.status(402).json({
          x402Version,
          error,
          accepts: toJsonSafe(paymentRequirements),
        });
        return;
      }
    } finally {
      res.end = originalEnd;
      if (endArgs) {
        originalEnd(...(endArgs as Parameters<typeof res.end>));
      }
    }
  };
}

export type {
  Money,
  Network,
  PaymentMiddlewareConfig,
  Resource,
  RouteConfig,
  RoutesConfig,
} from "x402/types";
// export type { Address as SolanaAddress } from "@solana/kit";
