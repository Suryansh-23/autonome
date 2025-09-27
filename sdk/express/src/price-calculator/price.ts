import { Price, Network } from "x402/types";
import { Request } from "express";
import { randomInt } from "crypto";

/**
 * dynamic pricing algorithm using RPS, inspired by EIP-1559 (ethereum gas fee model)
 * 
 * eip1559 params: minBase, maxBaseFee, defaultFee, changeRate (12.5%), targetUtilization (50 %), priorityFee (?), smoothingWindow, elasticityMultiplier
 * state: current base fee, current rps, target rps, rpsHiostry, baseFeeHistory, requestCounts (mapping), lastAdjustment (timestamp)
 * 
 * adjustBaseFee() = 
 * current rps = getCurrentRPS()
 * target rps = this.state.targetRPS
 * utilization = current / target
 * if currentRPS > targetRPS => excessRatio = (current - target ) / target; baseFeeMultiplier = 1 + Math.min(excessRatio * this.config.maxChangeRate, this.config.maxChangeRate);
 * if currentRPS < targetRPS => shortageRatio = (target - current) / target; baseFeeMultiplier = 1 - Math.min(shortageRatio * this.config.maxChangeRate, this.config.maxChangeRate);
 * else => baseFeeMultiplier = 1
 * 
 * newBaseFee = this.state.currentBase * baseFeeMultiplier
 * config.minBaseFee <= newBaseFee <= config.maxBaseFee
 * 
 * oldBaseFee = this.state.currentBaseFee, 
 * this.state.currentBaseFee = newBaseFee
 * this.state.baseFeeHistory.push(newBaseFee)
 * return newBaseFee
 * 
 * //////////////////////////////////////////////////////////////////////
 * 
 * getCurrentRPS() = 
 * now = Date.now(), before = now - 1000
 * for (const [timestamp, requstCount] of this.state.requestCounts) {
 *  if (timestamp >= before) {
 *   count += requestCount
 *  }
 * }
 * this.state.rpsHistory.push(count)
 * const avgRPS = this.state.rpsHistory.reduce((a, b) => a + b, 0) / this.state.rpsHistory.length;
 * this.state.currentRPS = avgRPS;
 * return avgRPS
 * 
 * 
*/

import { EIP1559InspiredConfig, EIP1559InspiredState } from "../config/config";


/**
 * tracks RPS, smooths them, and periodically adjusts a base fee up or down based on utilization relative to a target RPS
*/
export class EIP1559InspiredDynamicPricingCalculator {
    private config: EIP1559InspiredConfig;
    private state: EIP1559InspiredState;

    constructor(config: EIP1559InspiredConfig) {
        this.config = config;
        const defaultFeeNum = this.getNumberIntFromPrice(config.defaultFee, config.defaultFee);
        
        this.state = {
            currentBaseFee: defaultFeeNum, 
            currentRPS: 0,
            targetRPS: config.targetUtilization * 20, 
            // assuming max rps capacity of 20 for initial target calculation
            rpsHistory: [],
            baseFeeHistory: [defaultFeeNum],
            requestCounts: new Map<number, number>(),
            // second-bucketed counts keyed by timestamp (ms) rounded to nearest second
            lastAdjustment: Date.now()
        };
        console.log(`[EIP1559] initiated DynamicPricing class with config:`, this.config);
        console.log(`[EIP1559] initiated DynamicPricing class with current state:`, this.state);
    }

    /**
     * Main entry point for calculating dynamic price based on EIP-1559 algorithm
     * 
     */
    calculatePrice = (originalPrice: Price, req: Request, network: Network): Price => {
        this.recordRequest();
        
        // Always update RPS to get current metrics
        this.getCurrentRPS();
        
        const now = Date.now();
        const adjustmentInterval = this.config.adjustmentInterval; 
        
        if (now - this.state.lastAdjustment >= adjustmentInterval) {
            console.log(`[EIP1559] Adjustment interval passed (${adjustmentInterval}ms), adjusting base fee...`);
            // This is done to avoid price increase during sudden traffic spikes within the interval
            this.adjustBaseFee(); 
            // computes the this.state.currentBaseFee
            this.state.lastAdjustment = now;
        }
        
        const priceStr = `$${this.state.currentBaseFee.toFixed(4)}`;
        console.log(`[EIP1559] RPS: ${this.state.currentRPS.toFixed(2)}, Target: ${this.state.targetRPS}, Fee: ${priceStr}`);
        
        return priceStr;
    };

    /**
     * Records a request by bucketing it into second-level timestamps
     * More efficient than storing individual timestamps
     */
    private recordRequest(): void {
        const now = Date.now();
        const bucket = Math.floor(now / 1000) * 1000; 
        this.state.requestCounts.set(bucket, (this.state.requestCounts.get(bucket) || 0) + 1);
        
        // Clean up old buckets outside the smoothing window
        const cutoff = now - (this.config.smoothingWindow * 1000);
        for (const [timestamp] of this.state.requestCounts) {
            if (timestamp < cutoff) {
                this.state.requestCounts.delete(timestamp);
            }
        }
    }

    /**
     * Calculates current RPS with smoothing based on historical data
     * Uses bucketed request counts for efficiency
     */
    getCurrentRPS(): number {
        const now = Date.now();
        const oneSecondAgo = now - 1000;
        
        let count = 0;
        for (const [timestamp, requestCount] of this.state.requestCounts) {
            if (timestamp >= oneSecondAgo) {
                count += requestCount;
            }
        }

        // For testing rapid requests in same second, return current count directly
        // In production, this provides immediate feedback for burst traffic
        if (count > 0) {
            this.state.currentRPS = count;
            
            // Only add to smoothing history if this is a new second or significant change
            const lastHistoryValue = this.state.rpsHistory[this.state.rpsHistory.length - 1] || 0;
            if (this.state.rpsHistory.length === 0 || Math.abs(count - lastHistoryValue) > 1) {
                this.state.rpsHistory.push(count);
                if (this.state.rpsHistory.length > this.config.smoothingWindow) {
                    this.state.rpsHistory.shift();
                }
            }
            
            return count;
        }
        
        // If no recent requests, use smoothed historical average
        const avgRPS = this.state.rpsHistory.length > 0 
            ? this.state.rpsHistory.reduce((a, b) => a + b, 0) / this.state.rpsHistory.length
            : 0;
        
        this.state.currentRPS = avgRPS;
        return avgRPS;
    }

    /**
     * Core EIP-1559 algorithm: adjusts base fee based on utilization
     * Similar to Ethereum's gas fee adjustment mechanism
     */
    adjustBaseFee(): number {
        const currentRPS = this.getCurrentRPS();
        const targetRPS = this.state.targetRPS;
        
        // Avoid division by zero
        if (targetRPS === 0) {
            console.log(`[EIP1559] Warning: targetRPS is 0, using default fee`);
            return this.getNumberIntFromPrice(this.config.defaultFee, this.config.defaultFee);
        }
        
        const utilization = currentRPS / targetRPS;
        let baseFeeMultiplier: number;
        console.log(`[EIP1559] Current RPS: ${currentRPS.toFixed(2)}, Target RPS: ${targetRPS}, Utilization: ${(utilization * 100).toFixed(2)}%`);
        if (utilization > 1) {
            // Over capacity - increase fee aggressively
            const excessRatio = (utilization - 1) / 1;
            baseFeeMultiplier = 1 + Math.min(excessRatio * this.config.maxChangeRate * this.config.elasticityMultiplier, this.config.maxChangeRate);
            console.log(`[EIP1559] Over capacity (${(utilization * 100).toFixed(1)}%), increasing fee by ${((baseFeeMultiplier - 1) * 100)}%`);
        } else if (utilization < this.config.targetUtilization) {
            // Under target utilization - decrease fee
            const shortageRatio = (this.config.targetUtilization - utilization) / this.config.targetUtilization;
            baseFeeMultiplier = 1 - Math.min(shortageRatio * this.config.maxChangeRate, this.config.maxChangeRate);
            console.log(`[EIP1559] Under utilization (${(utilization * 100).toFixed(2)}%), decreasing fee by ${((1 - baseFeeMultiplier) * 100)}%`);
        } else {
            // Within acceptable range - keep fee stable
            baseFeeMultiplier = 1;
            console.log(`[EIP1559] Within target range (${(utilization * 100).toFixed(1)}%), fee stable`);
        }
        
        const minFee = this.getNumberIntFromPrice(this.config.minBaseFee, this.config.minBaseFee);
        const maxFee = this.getNumberIntFromPrice(this.config.maxBaseFee, this.config.maxBaseFee);
        // minFee <= (currentBaseFee * baseFeeMultiplier) <= maxFee
        const newBaseFee = Math.max(minFee, Math.min(this.state.currentBaseFee * baseFeeMultiplier, maxFee));
        
        // Update state
        const oldBaseFee = this.state.currentBaseFee;
        this.state.currentBaseFee = newBaseFee;
        this.state.baseFeeHistory.push(newBaseFee);
        if (this.state.baseFeeHistory.length > this.config.smoothingWindow) {
            this.state.baseFeeHistory.shift();
        }

        console.log(`[EIP1559] Fee adjustment: $${oldBaseFee} → $${newBaseFee}`);
        return newBaseFee;
    }

    /**
     * Get comprehensive metrics for monitoring and debugging
     */
    getEIP1559Metrics() {
        const utilization = this.state.targetRPS > 0 
            ? (this.state.currentRPS / this.state.targetRPS) * 100 
            : 0;
            
        return {
            currentRPS: this.state.currentRPS,
            targetRPS: this.state.targetRPS,
            utilization: `${utilization.toFixed(1)}%`,
            currentBaseFee: `$${this.state.currentBaseFee.toFixed(4)}`,
            requestCount: Array.from(this.state.requestCounts.values()).reduce((a, b) => a + b, 0),
            activeSeconds: this.state.requestCounts.size,
            historySize: this.state.rpsHistory.length,
            baseFeeHistory: this.state.baseFeeHistory.slice(-5).map(fee => `$${fee.toFixed(6)}`), // Last 5 adjustments
            lastAdjustment: new Date(this.state.lastAdjustment).toISOString()
        };
    }

    /**
     * Reset state (useful for testing or restarting metrics)
     */
    reset(): void {
        const defaultFeeNum = this.getNumberIntFromPrice(this.config.defaultFee, this.config.defaultFee);
        this.state = {
            currentBaseFee: defaultFeeNum,
            currentRPS: 0,
            targetRPS: this.config.targetUtilization * 20,
            rpsHistory: [],
            baseFeeHistory: [defaultFeeNum],
            requestCounts: new Map<number, number>(),
            lastAdjustment: Date.now()
        };
        console.log(`[EIP1559] State reset to defaults`);
    }

    /**
     * Force fee adjustment (useful for testing)
     */
    forceAdjustment(): void {
        this.adjustBaseFee();
        this.state.lastAdjustment = Date.now();
    }

    /**
     * Update configuration at runtime (useful for dynamic tuning)
     */
    updateConfig(newConfig: Partial<EIP1559InspiredConfig>): void {
        this.config = { ...this.config, ...newConfig };
        
        // Recalculate target RPS if targetUtilization changed
        if (newConfig.targetUtilization !== undefined) {
            this.state.targetRPS = newConfig.targetUtilization * 20;
        }
        
        console.log(`[EIP1559] Configuration updated:`, newConfig);
    }

    /**
     * Helper function to convert Price union to number
     * Handles string, number, and complex price objects
     */
    private getNumberIntFromPrice(originalPrice: Price, price: Price): number {
        if (typeof price === 'string') {
            return parseFloat(price.replace('$', ''));
        }
        if (typeof price === 'number') {
            return price;
        }
        // For complex price objects, fall back to original or default
        return typeof originalPrice === "string" ? parseFloat(originalPrice.replace('$', '')) : 0.001;
    }
}