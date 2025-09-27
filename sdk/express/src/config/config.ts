import { Price, Network } from "x402/types";

// export interface FacilitatorConfig {}

export interface EIP1559InspiredConfig {
    minBaseFee: Price;
    maxBaseFee: Price;          
    defaultFee: Price;          
    maxChangeRate: number;      
    targetUtilization: number;  
    smoothingWindow: number;    
    elasticityMultiplier: number;
    adjustmentInterval: number; // milliseconds between fee adjustments
}

/**
 * Factory function to create EIP1559InspiredConfig with sensible defaults
 * Developers can override specific values as needed
 */
export function createEIP1559Config(overrides: Partial<EIP1559InspiredConfig> = {}): EIP1559InspiredConfig {
    const defaults: EIP1559InspiredConfig = {
        minBaseFee: "$0.001",    
        maxBaseFee: "$0.05",          
        defaultFee: "$0.001",         
        maxChangeRate: 0.125,       
        targetUtilization: 0.5,
        smoothingWindow: 30,           
        elasticityMultiplier: 2.0,
        adjustmentInterval: 10000      // 10 seconds in production
    };
    
    return { ...defaults, ...overrides };
}

export interface EIP1559InspiredState {
    currentBaseFee: number, 
    currentRPS: number,
    targetRPS: number,
    rpsHistory: number[], 
    baseFeeHistory: number[], 
    requestCounts: Map<number, number>, 
    lastAdjustment: number 
}

export class MonitoringState {
    requestCounts: Map<number, number> = new Map()
    feeCollected: Map<number, number> = new Map()

    constructor() {
        this.requestCounts = new Map()
        this.feeCollected = new Map()
    }

    record(timestamp: number, fee: number) {
        const currentCount = this.requestCounts.get(timestamp) || 0
        this.requestCounts.set(timestamp, currentCount + 1)

        const currentFee = this.feeCollected.get(timestamp) || 0
        this.feeCollected.set(timestamp, currentFee + fee)
    }

    getRequestAt(timestamp: number): number {
        return this.requestCounts.get(timestamp) || 0
    }

    getFeeAt(timestamp: number): number {
        return this.feeCollected.get(timestamp) || 0
    }

    getTotalRequests(): number {
        let total = 0
        for (const count of this.requestCounts.values()) {
            total += count
        }
        return total
    }

    getTotalFees(): number {
        let total = 0
        for (const fee of this.feeCollected.values()) {
            total += fee
        }
        return total
    }
}