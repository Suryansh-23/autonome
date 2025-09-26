import { Price } from "x402/types";
import { DynamicPricingConfig } from "../config/config";
import { randomInt } from "crypto";

/**
 * Helper class to track requests per second (RPS) 
*/
export class RPSTracker {
    private requestTimestamps: number[] = []; // or use mapping ?
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

    // @note for testing purposes and seeing how the middleware works, we are returning a random number between 0-10
    // later will implement the actual dynamic pricing logic with rps 
    calculatePrice(): number{
        // const currentRPS = this.rpsTracker.record();
        // const { basePrice, maxPrice, rpsThreshold, multiplier } = this.config;
        console.log(`calculatePrice method from DynamicPricingCalculator class called, returning random number.`)
        return randomInt(10);
    }
}