import { Price, Network } from "x402/types";
import { Request } from "express";
import { DynamicPricingConfig } from "../config/config";
import { randomInt } from "crypto";

/**
 * Helper class to track requests per second (RPS) 
*/
export class RPSTracker {
    public requestTimestamps: number[] = []; // or use mapping ?
    private windowSize: number

    constructor(windowMS: number = 60000) { 
        this.windowSize = windowMS;
    }

    record() {
        const now = Date.now();
        this.requestTimestamps.push(now);
        
        const cutoff = now - this.windowSize;
        this.requestTimestamps = this.requestTimestamps.filter(ts => ts > cutoff);
        return this.getCurrentRPS();
    }

    getCurrentRPS() {
        const now = Date.now();
        const cutoff = now - this.windowSize;
        const recentRequests = this.requestTimestamps.filter(ts => ts > cutoff);
        // total requests within the window divided by window size in seconds
        return recentRequests.length / (this.windowSize / 1000);
    }
}

/**
 * Holds RPSTracker instance and DynamicPricingConfig: {basePrice, maxPrice, rpsThreshold, multiplier}
 * calculatePrice(originalPrice, req, network): Price - function siugnature and reutnr type is Price 9x402/types)
 *  
*/
export class DynamicPricingCalculator {

    private rpsTracker: RPSTracker;
    private config: DynamicPricingConfig;

    constructor(config: DynamicPricingConfig) {
        this.config = config;
        this.rpsTracker = new RPSTracker(); 
    }

    calculatePrice = (originalPrice: Price, req: Request, network: Network): Price => {
        // console.log(`calculatePrice method from DynamicPricingCalculator class called, returning random number.`)
        // return randomInt(10);

        const currentRPS = this.rpsTracker.record();
        const { basePrice, maxPrice, rpsThreshold, multiplier } = this.config;
        const baseNum = this.getNumberIntFromPrice(originalPrice, basePrice);
        const maxNum = this.getNumberIntFromPrice(originalPrice, maxPrice);

        if (currentRPS <= rpsThreshold) {
            console.log(`[DynamicPricing] Current RPS: ${currentRPS.toFixed(2)} within threshold ${rpsThreshold}, returning base price: ${baseNum}`);
            return basePrice;
        }

        const excessRPS = currentRPS - rpsThreshold;
        const priceIncrease = excessRPS * multiplier;
        const newPrice = Math.min(baseNum + priceIncrease, maxNum);
        const returnedPrice = `$${newPrice.toFixed(4)}`;
        console.log(`[DynamicPricing] Current RPS: ${currentRPS.toFixed(2)} exceeds threshold ${rpsThreshold}, increasing price to: ${returnedPrice}`);
        return returnedPrice;
    }

    getRPSDetails() {
        return {
            rps: this.rpsTracker.getCurrentRPS(),
            requestCount: this.rpsTracker.requestTimestamps.length
        }
    }

    getNumberIntFromPrice(originalPrice: Price, price: Price): number {

        if (typeof price === 'string') {
            return parseFloat(price.replace('$', ''));
        }
        if (typeof price === 'number') {
            return price;
        }
        return typeof originalPrice === "string" ? parseFloat(originalPrice.replace('$', '')) : 0.001;
    }
}