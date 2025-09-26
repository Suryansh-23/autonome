import { Request, Response, NextFunction } from "express";
import { botDetection } from "../bot-detection/bot";
import { paymentMiddleware, DynamicPriceCalculator } from "../x402-payment/payment";
import { Address } from "viem";
import { RoutesConfig, FacilitatorConfig, PaywallConfig } from "x402/types";
import { DynamicPricingCalculator } from "../price-calculator/price";
import { DynamicPricingConfig } from "../config/config";

export function middleware(
  payTo: Address,
  routes: RoutesConfig,
  facilitator?: FacilitatorConfig,
  paywall?: PaywallConfig,
  dynamicPricingConfig?: DynamicPricingConfig | DynamicPriceCalculator
) {

  let paymentHandler;
  if (dynamicPricingConfig) {
    if (typeof dynamicPricingConfig === 'function') {
      // Direct calculator function provided
      paymentHandler = paymentMiddleware(payTo, routes, facilitator, paywall, dynamicPricingConfig);
    } else {
      // Config object provided, create calculator
      const pricingCalculator = new DynamicPricingCalculator(dynamicPricingConfig);
      paymentHandler = paymentMiddleware(payTo, routes, facilitator, paywall, pricingCalculator.calculatePrice);
    }
  } else {
    console.log(`[middleware-log] dynamic pricing config is absent, using default static pricing`)
    paymentHandler = paymentMiddleware(payTo, routes, facilitator, paywall);
  }

  return function (req: Request, res: Response, next: NextFunction) {
    const isBot = botDetection(req, res, next);
    
    if (isBot) {
      // Bot detected → require payment
      return paymentHandler(req, res, next);
    } else {
      // Human user → allow through
      return next();
    }
  };
}

export function setHeaderMiddleware(evmAddress: string, res: Response, next: NextFunction) {
  try {
    res.setHeader('evm-address', evmAddress);
    console.log(`[header-middleware-log] Set evm-address header to ${evmAddress}`);
    next();
  } catch (error) {
    console.error("Error setting evm-address header:", error);
    next(error);
  }
}