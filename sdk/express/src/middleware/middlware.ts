import { Request, Response, NextFunction } from "express";
import { botDetection } from "../bot-detection/bot";
import { paymentMiddleware, DynamicPriceCalculator } from "../x402-payment/payment";
import { Address } from "viem";
import { RoutesConfig, FacilitatorConfig, PaywallConfig } from "x402/types";
import { EIP1559InspiredConfig, MonitoringState } from "../config/config";
import { EIP1559InspiredDynamicPricingCalculator } from "../price-calculator/price";

export function middleware(
  payTo: Address,
  routes: RoutesConfig,
  facilitator?: FacilitatorConfig,
  paywall?: PaywallConfig,
  dynamicPricingConfig?: EIP1559InspiredConfig | DynamicPriceCalculator,
  monitoringEndpoint: string = '/middleware-monitoring'
) {
  // Initialize monitoring state
  const monitoringState = new MonitoringState();

  // Setup pricing handler based on dynamic pricing config
  let paymentHandler;
  if (dynamicPricingConfig) {
    if (typeof dynamicPricingConfig === 'function') {
      paymentHandler = paymentMiddleware(payTo, routes, monitoringState, facilitator, paywall, dynamicPricingConfig);
    } else {
      const pricingCalculator = new EIP1559InspiredDynamicPricingCalculator(dynamicPricingConfig);
      paymentHandler = paymentMiddleware(payTo, routes, monitoringState, facilitator, paywall, pricingCalculator.calculatePrice);
    }
  } else {
    console.log(`[middleware-log] dynamic pricing config is absent, using default static pricing`);
    paymentHandler = paymentMiddleware(payTo, routes, monitoringState, facilitator, paywall, undefined);
  }

  console.log(`[middleware-log] Monitoring endpoint will be available at ${monitoringEndpoint}`);

  return function (req: Request, res: Response, next: NextFunction) {

    // Handle monitoring endpoint directly in the middleware
    if (req.method === 'GET' && req.path === monitoringEndpoint) {
      const totalRequests = monitoringState.getTotalRequests();
      const totalRevenue = monitoringState.getTotalFees();
      return res.status(200).json({
        success: true,
         data: {
          totalRequests,
          totalRevenue
        }
      });
    }

    // Bot Detection and X402 Payment Handling
    const isBot = botDetection(req, res, next);
    
    if (isBot) {
      return paymentHandler(req, res, next);
    } else {
      return next();
    }
  };
}

export function setHeaderMiddleware(evmAddress: string, res: Response, next: NextFunction) {
  try {
    res.setHeader('X-PAYMENT-ADDRESS', evmAddress);
    console.log(`[header-middleware-log] Set X-PAYMENT-ADDRESS header to ${evmAddress}`);
    next();
  } catch (error) {
    console.error("Error setting X-PAYMENT-ADDRESS header:", error);
    next(error);
  }
}