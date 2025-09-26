import { Price, Network } from "x402/types";

export interface DynamicPricingConfig {
    basePrice: Price, 
    maxPrice: Price, 
    rpsThreshold: number, 
    multiplier: number
}


// export interface FacilitatorConfig {}

export interface EIP1559InspiredConfig {
    minBaseFee: Price;
    maxBaseFee: Price;          
    defaultFee: Price;          
    maxChangeRate: number;      
    targetUtilization: number;  
    smoothingWindow: number;    
    elasticityMultiplier: number; 
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
        elasticityMultiplier: 2.0     
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