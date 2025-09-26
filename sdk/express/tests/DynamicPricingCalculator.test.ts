import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DynamicPricingCalculator } from '../src/price-calculator/price';
import { DynamicPricingConfig } from '../src/config/config';
import { Request } from 'express';
import { Price } from 'x402/types';

// Mock Express Request
const mockRequest = {
  path: '/test',
  method: 'GET',
  headers: { 'user-agent': 'test-agent' }
} as Request;

describe('DynamicPricingCalculator', () => {
  let calculator: DynamicPricingCalculator;
  let config: DynamicPricingConfig;

  beforeEach(() => {
    // Reset configuration for each test
    config = {
      basePrice: '$0.001',
      maxPrice: '$0.01',
      rpsThreshold: 5,
      multiplier: 0.0002
    };
    // Use a shorter window (1 second) for testing to make RPS calculations more responsive
    calculator = new DynamicPricingCalculator(config, 1000);
    vi.clearAllMocks();
  });

  describe('Constructor and Initial State', () => {
    it('should initialize with correct configuration', () => {
      console.log('[TEST] Testing DynamicPricingCalculator initialization');
      
      const metrics = calculator.getRPSDetails();
      console.log('[TEST] Initial metrics:', metrics);
      
      expect(metrics.rps).toBe(0);
      expect(metrics.requestCount).toBe(0);
    });
  });

  describe('Price Calculation Under Different RPS Scenarios', () => {
    it('should return base price when RPS is below threshold', () => {
      console.log('[TEST] Testing base price when RPS below threshold');
      
      // Simulate 3 requests (below threshold of 5)
      for (let i = 0; i < 3; i++) {
        calculator.calculatePrice('$0.001', mockRequest, 'arbitrum-sepolia');
      }
      
      const metrics = calculator.getRPSDetails();
      console.log('[TEST] Metrics after 3 requests:', metrics);
      
      const price = calculator.calculatePrice('$0.001', mockRequest, 'arbitrum-sepolia');
      console.log('[TEST] Calculated price (below threshold):', price);
      
      expect(price).toBe('$0.001'); 
      // Should return base price
    });

    it('should increase price when RPS exceeds threshold', () => {
      console.log('[TEST] Testing price increase when RPS exceeds threshold');
      
      // Simulate 20 requests in quick succession (above threshold of 5)
      const prices: string[] = [];
      for (let i = 0; i < 20; i++) {
        const price = calculator.calculatePrice('$0.001', mockRequest, 'arbitrum-sepolia');
        prices.push(price as string);
        console.log(`[TEST] Request ${i + 1}, Price: ${price}`);
      }
      
      const metrics = calculator.getRPSDetails();
      console.log('[TEST] Final metrics after 20 requests:', metrics);
      
      const finalPrice = parseFloat(prices[prices.length - 1].replace('$', ''));
      const basePrice = typeof config.basePrice === 'string' 
        ? parseFloat(config.basePrice.replace('$', ''))
        : config.basePrice as number;
      console.log('[TEST] Final price vs base price:', finalPrice, 'vs', basePrice);
      expect(finalPrice).toBeGreaterThan(basePrice);
    });

    it('should cap price at maxPrice', () => {
      console.log('[TEST] Testing price capping at maxPrice, sending 60 requests');
      
      // Simulate very high RPS by making many requests rapidly
      const prices: string[] = [];
      for (let i = 0; i < 60; i++) {
        const price = calculator.calculatePrice('$0.001', mockRequest, 'arbitrum-sepolia');
        prices.push(price as string);
      }
      
      const finalPrice = parseFloat(prices[prices.length - 1].replace('$', ''));
      const maxPrice = typeof config.maxPrice === 'string' 
        ? parseFloat(config.maxPrice.replace('$', ''))
        : config.maxPrice as number;
      
      console.log('[TEST] Final price:', finalPrice, 'Max allowed:', maxPrice);
      expect(finalPrice).toBeLessThanOrEqual(maxPrice);
    });
  });


  describe('Price Calculation Mathematics', () => {
    it('should calculate price increase correctly based on multiplier', () => {
      console.log('[TEST] Testing price calculation mathematics');
      
      // Set up a controlled scenario
      const testConfig: DynamicPricingConfig = {
        basePrice: '$0.001', // 0.001
        maxPrice: '$0.01',   // 0.01
        rpsThreshold: 2,     // Very low threshold for easy testing
        multiplier: 0.001    // $0.001 per excess RPS
      };
      
      const testCalculator = new DynamicPricingCalculator(testConfig, 1000); // 1-second window
      console.log('[TEST] Test config:', JSON.stringify(testConfig));
      
      // Make exactly 5 requests to get ~5 RPS
      for (let i = 0; i < 5; i++) {
        testCalculator.calculatePrice('$0.001', mockRequest, 'arbitrum-sepolia');
      }
      
      const metrics = testCalculator.getRPSDetails();
      const price = testCalculator.calculatePrice('$0.001', mockRequest, 'arbitrum-sepolia');
      
      console.log('[TEST] Metrics with 5 requests:', metrics);
      console.log('[TEST] Calculated price:', price);
      
      // Expected: basePrice + (excessRPS * multiplier)
      // If RPS ≈ 5, excess = 5 - 2 = 3, price = 0.001 + (3 * 0.001) = $0.004
      const numericPrice = typeof price === 'string' 
        ? parseFloat(price.replace('$', ''))
        : price as number;
      expect(numericPrice).toBeGreaterThan(0.001);
    });

    it('should handle edge cases gracefully', () => {
      console.log('[TEST] Testing edge cases');
      
      // Test with zero multiplier
      const zeroMultiplierConfig: DynamicPricingConfig = {
        basePrice: '$0.001',
        maxPrice: '$0.01',
        rpsThreshold: 1,
        multiplier: 0
      };
      
      const zeroCalculator = new DynamicPricingCalculator(zeroMultiplierConfig);
      
      // Even with high RPS, price should stay at base due to zero multiplier
      for (let i = 0; i < 20; i++) {
        zeroCalculator.calculatePrice('$0.001', mockRequest, 'arbitrum-sepolia');
      }
      
      const price = zeroCalculator.calculatePrice('$0.001', mockRequest, 'arbitrum-sepolia');
      console.log('[TEST] Price with zero multiplier:', price);
      
      expect(price).toBe('$0.001');
    });
  });

  describe('getNumberIntFromPrice Helper Function', () => {
    it('should parse different price formats correctly', () => {
      console.log('[TEST] Testing price parsing functionality');
      
      // Test string prices
      const stringPrice = calculator.getNumberIntFromPrice('$0.001', '$0.005');
      console.log('[TEST] Parsed string price $0.005:', stringPrice);
      expect(stringPrice).toBe(0.005);
      
      // Test numeric prices
      const numericPrice = calculator.getNumberIntFromPrice('$0.001', 0.007);
      console.log('[TEST] Parsed numeric price 0.007:', numericPrice);
      expect(numericPrice).toBe(0.007);
      
      // Test fallback with invalid price
      const fallbackPrice = calculator.getNumberIntFromPrice('$0.001', {} as any);
      console.log('[TEST] Fallback price for invalid input:', fallbackPrice);
      expect(fallbackPrice).toBe(0.001);
    });
  });

});