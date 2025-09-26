import { Price, Network } from "x402/types";

export interface DynamicPricingConfig {
    basePrice: Price, 
    maxPrice: Price, 
    rpsThreshold: number, 
    multiplier: number
}


export interface FacilitatorConfig {}