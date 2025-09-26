import { Request, Response, NextFunction } from "express";
import { botDetection } from "../bot-detection/bot";
import { paymentMiddleware } from "../x402-payment/payment";
import { Address } from "viem";
import { RoutesConfig, FacilitatorConfig, PaywallConfig } from "x402/types";

export function middleware(
  payTo: Address,
  routes: RoutesConfig,
  facilitator?: FacilitatorConfig,
  paywall?: PaywallConfig,
) {
  const paymentHandler = paymentMiddleware(payTo, routes, facilitator, paywall);

  return function (req: Request, res: Response, next: NextFunction) {
    console.log("Middleware executed");
    const isBot = botDetection(req, res, next);
    
    if (isBot) {
      console.log("Bot detected");
      // Bot detected → require payment
      return paymentHandler(req, res, next);
    } else {
      console.log("Human detected");
      // Human user → allow through
      return next();
    }
  };
}