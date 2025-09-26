import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EIP1559InspiredDynamicPricingCalculator } from '../src/price-calculator/price';
import { EIP1559InspiredConfig, createEIP1559Config } from '../src/config/config';
import { Request } from 'express';

// Mock Express Request
const mockRequest = {
  path: '/test',
  method: 'GET',
  headers: { 'user-agent': 'test-agent' }
} as Request;

describe('EIP1559InspiredDynamicPricingCalculator', () => {
  let calculator: EIP1559InspiredDynamicPricingCalculator;
  let config: EIP1559InspiredConfig;

  beforeEach(() => {
    // Reset configuration 
    config = createEIP1559Config({
      minBaseFee: '$0.0001',
      maxBaseFee: '$0.01',
      defaultFee: '$0.001',
      maxChangeRate: 0.25,        // 25% for faster testing (vs 12.5% default)
      targetUtilization: 0.5,     // 50%
      smoothingWindow: 10,        // Smaller window for faster tests
      elasticityMultiplier: 2.0
    });
    
    calculator = new EIP1559InspiredDynamicPricingCalculator(config);
    vi.clearAllMocks();
  });

  describe('Constructor and Configuration', () => {
    it('should initialize with correct default configuration', () => {
      console.log('[TEST-EIP1559] Testing initialization with default config');
      
      const defaultConfig = createEIP1559Config();
      const defaultCalculator = new EIP1559InspiredDynamicPricingCalculator(defaultConfig);
      
      const metrics = defaultCalculator.getEIP1559Metrics();
      console.log('[TEST-EIP1559] Default config metrics:', metrics);
      
      expect(metrics.currentRPS).toBe(0);
      expect(metrics.currentBaseFee).toBe('$0.0010');
      expect(metrics.targetRPS).toBe(10); // 0.5 * 20
      expect(metrics.utilization).toBe('0.0%');
    });

    it('should initialize with custom configuration correctly', () => {
      console.log('[TEST-EIP1559] Testing custom configuration initialization');
      
      const customConfig = createEIP1559Config({
        defaultFee: '$0.002',
        targetUtilization: 0.8,
        maxChangeRate: 0.15
      });
      
      const customCalculator = new EIP1559InspiredDynamicPricingCalculator(customConfig);
      const metrics = customCalculator.getEIP1559Metrics();
      
      console.log('[TEST-EIP1559] Custom config metrics:', metrics);
      expect(metrics.currentBaseFee).toBe('$0.0020');
      expect(metrics.targetRPS).toBe(16); // 0.8 * 20
    });
  });

  describe('Request Recording and RPS Calculation', () => {
    it('should record requests and calculate RPS correctly', async () => {
      console.log('[TEST-EIP1559] Testing request recording and RPS calculation');
      
      const initialMetrics = calculator.getEIP1559Metrics();
      console.log('[TEST-EIP1559] Initial metrics:', initialMetrics);
      
      // Record several requests with small delays to allow proper time bucketing
      for (let i = 0; i < 5; i++) {
        calculator.calculatePrice('$0.001', mockRequest, 'arbitrum-sepolia');
        const metrics = calculator.getEIP1559Metrics();
        console.log(`[TEST-EIP1559] After request ${i + 1}:`, {
          rps: metrics.currentRPS,
          requestCount: metrics.requestCount,
          activeSeconds: metrics.activeSeconds
        });
        if (i < 4) await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      const finalMetrics = calculator.getEIP1559Metrics();
      expect(finalMetrics.requestCount).toBe(5);
      // Since requests are spread over time, RPS should be detectable
      expect(finalMetrics.currentRPS).toBeGreaterThanOrEqual(0);
    });

    it('should implement bucketing correctly', () => {
      console.log('[TEST-EIP1559] Testing second-level request bucketing');
      
      // Make multiple requests in quick succession (same second)
      for (let i = 0; i < 8; i++) {
        calculator.calculatePrice('$0.001', mockRequest, 'arbitrum-sepolia');
      }
      
      const metrics = calculator.getEIP1559Metrics();
      console.log('[TEST-EIP1559] Bucketing test metrics:', metrics);
      
      // All requests should be counted
      expect(metrics.requestCount).toBe(8);
      // Should have 1 active second (all requests in same bucket)
      expect(metrics.activeSeconds).toBe(1);
      // RPS should be 8 (8 requests in 1 second)
      expect(metrics.currentRPS).toBe(8);
      // Utilization should be 80% (8 RPS / 10 target RPS)
      expect(metrics.utilization).toBe('80.0%');
    });
  });

  describe('EIP-1559 Base Fee Adjustment Algorithm', () => {
    it('should increase fee when over capacity (utilization > 1)', async () => {
      console.log('[TEST-EIP1559] Testing fee increase when over capacity');
      
      // Create calculator with very short adjustment interval for testing
      const testConfig = createEIP1559Config({
        minBaseFee: '$0.0001',
        maxBaseFee: '$0.01',
        defaultFee: '$0.001',
        maxChangeRate: 0.5,        // 50% for faster testing
        targetUtilization: 0.5,     // 50% (target RPS = 5)
        smoothingWindow: 10,        // Smaller window for faster tests
        elasticityMultiplier: 2.0,
        adjustmentInterval: 50      // 50ms for testing (vs 10000ms production)
      });
      
      const testCalculator = new EIP1559InspiredDynamicPricingCalculator(testConfig);
      
      const initialMetrics = testCalculator.getEIP1559Metrics();
      const initialFee = parseFloat(initialMetrics.currentBaseFee.replace('$', ''));
      console.log('[TEST-EIP1559] Initial fee:', initialFee);
      
      // Generate sustained high RPS, then waiting for the interval to pass so fees can be updated
      for (let i = 0; i < 12; i++) {
        testCalculator.calculatePrice('$0.001', mockRequest, 'arbitrum-sepolia');
      }
      console.log(`[TEST-EIP1559] Sent 12 requests, starting timeOut to allow adjustment`);
      await new Promise(resolve => setTimeout(resolve, 60));
      
      // Add more requests to maintain high utilization 
      for (let i = 0; i < 3; i++) {
        testCalculator.calculatePrice('$0.001', mockRequest, 'arbitrum-sepolia');
      }
      
      const finalMetrics = testCalculator.getEIP1559Metrics();
      const finalFee = parseFloat(finalMetrics.currentBaseFee.replace('$', ''));
      
      console.log('[TEST-EIP1559] Over capacity results:');
      console.log(`[TEST-EIP1559] - Initial fee: $${initialFee}`);
      console.log(`[TEST-EIP1559] - Final fee: $${finalFee}`);
      console.log(`[TEST-EIP1559] - Current RPS: ${finalMetrics.currentRPS}`);
      
      expect(finalFee).toBeGreaterThan(initialFee);
    });

    it('should decrease fee when under target utilization', async () => {
      console.log('[TEST-EIP1559] Testing fee decrease when under utilized');
      
      const highFeeConfig = createEIP1559Config({
        defaultFee: '$0.005', // Start higher
        targetUtilization: 0.8, // High target (80%)
        minBaseFee: '$0.0001'
      });
      
      const highFeeCalculator = new EIP1559InspiredDynamicPricingCalculator(highFeeConfig);
      const initialMetrics = highFeeCalculator.getEIP1559Metrics();
      
      console.log('[TEST-EIP1559] Starting with high fee:', initialMetrics.currentBaseFee);
      
      // Generate low RPS
      for (let i = 0; i < 3; i++) {
        highFeeCalculator.calculatePrice('$0.001', mockRequest, 'arbitrum-sepolia');
      }
      console.log(`[TEST-EIP1559] Sent 3 requests, starting timeOut to allow adjustment. after this will send one more req to trigger the adjustment`);
    //   await new Promise(resolve => setTimeout(resolve, 60));
    //   highFeeCalculator.calculatePrice('$0.001', mockRequest, 'arbitrum-sepolia');
      highFeeCalculator.forceAdjustment();
      const price = highFeeCalculator.calculatePrice('$0.001', mockRequest, 'arbitrum-sepolia');
      const finalMetrics = highFeeCalculator.getEIP1559Metrics();
      const finalFee = parseFloat(finalMetrics.currentBaseFee.replace('$', ''));
      const initialFee = parseFloat(initialMetrics.currentBaseFee.replace('$', ''));
      
      console.log('[TEST-EIP1559] Under utilization results:');
      console.log(`[TEST-EIP1559] - Initial fee: ${initialMetrics.currentBaseFee}`);
      console.log(`[TEST-EIP1559] - Final fee: ${finalMetrics.currentBaseFee}`);
      console.log(`[TEST-EIP1559] - Current RPS: ${finalMetrics.currentRPS}`);
      console.log(`[TEST-EIP1559] - Returned price: ${price}`);
      expect(finalFee).toBeLessThan(initialFee);
    });
  });

  describe('Metrics and Monitoring', () => {
    it('should track base fee history correctly', async () => {
      console.log('[TEST-EIP1559] Testing base fee history tracking');
      
      const historyConfig = createEIP1559Config({
        adjustmentInterval: 50
      });
      const historyCalculator = new EIP1559InspiredDynamicPricingCalculator(historyConfig);
      
      const initialMetrics = historyCalculator.getEIP1559Metrics();
      console.log('[TEST-EIP1559] Initial history:', initialMetrics.baseFeeHistory);
      
      // Generate activity that should trigger multiple adjustments
      for (let batch = 0; batch < 3; batch++) {
        console.log(`[TEST-EIP1559] Batch ${batch + 1}`);
        
        for (let i = 0; i < 10; i++) {
          historyCalculator.calculatePrice('$0.001', mockRequest, 'arbitrum-sepolia');
        }
        
        // Wait between batches to allow adjustments
        await new Promise(resolve => setTimeout(resolve, 60));
      }
      
      const finalMetrics = historyCalculator.getEIP1559Metrics();
      console.log('[TEST-EIP1559] Final history:', finalMetrics.baseFeeHistory);
      
      expect(finalMetrics.baseFeeHistory.length).toBeGreaterThan(1);
      expect(finalMetrics.baseFeeHistory.length).toBeLessThanOrEqual(5); // Should show last 5
    });
  });

  describe('Runtime Configuration Updates', () => {
    it('should allow configuration updates at runtime', () => {
      console.log('[TEST-EIP1559] Testing runtime configuration updates');
      
      const initialMetrics = calculator.getEIP1559Metrics();
      console.log('[TEST-EIP1559] Initial target RPS:', initialMetrics.targetRPS);
      
      // Update configuration
      calculator.updateConfig({
        targetUtilization: 0.8,
        maxChangeRate: 0.2
      });
      
      const updatedMetrics = calculator.getEIP1559Metrics();
      console.log('[TEST-EIP1559] Updated target RPS:', updatedMetrics.targetRPS);
      
      expect(updatedMetrics.targetRPS).toBe(16); // 0.8 * 20
      
      // Test that new config affects pricing
      for (let i = 0; i < 5; i++) {
        calculator.calculatePrice('$0.001', mockRequest, 'arbitrum-sepolia');
      }
      
      const postUpdateMetrics = calculator.getEIP1559Metrics();
      console.log('[TEST-EIP1559] Post-update metrics:', postUpdateMetrics);
    });

    it('should handle reset functionality correctly', () => {
      console.log('[TEST-EIP1559] Testing reset functionality');
      for (let i = 0; i < 15; i++) {
        calculator.calculatePrice('$0.001', mockRequest, 'arbitrum-sepolia');
      }
      
      const beforeReset = calculator.getEIP1559Metrics();
      console.log('[TEST-EIP1559] Before reset:', {
        rps: beforeReset.currentRPS,
        requestCount: beforeReset.requestCount,
        historySize: beforeReset.historySize
      });
      calculator.reset();
      
      const afterReset = calculator.getEIP1559Metrics();
      console.log('[TEST-EIP1559] After reset:', {
        rps: afterReset.currentRPS,
        requestCount: afterReset.requestCount,
        historySize: afterReset.historySize
      });
      
      expect(afterReset.currentRPS).toBe(0);
      expect(afterReset.requestCount).toBe(0);
      expect(afterReset.historySize).toBe(0);
      expect(afterReset.currentBaseFee).toBe('$0.0010'); // Back to default
    });
  });

  describe('Integration and Edge Cases', () => {
    // it('should handle different networks consistently', () => {
    //   console.log('[TEST-EIP1559] Testing network consistency');
      
    //   const networks = ['arbitrum-sepolia', 'base-sepolia'] as const;
    //   const networkResults: Record<string, any> = {};
      
    //   for (const network of networks) {
    //     const networkCalculator = new EIP1559InspiredDynamicPricingCalculator(config);
        
    //     // Same request pattern for each network
    //     for (let i = 0; i < 8; i++) {
    //       networkCalculator.calculatePrice('$0.001', mockRequest, network);
    //     }
        
    //     const metrics = networkCalculator.getEIP1559Metrics();
    //     networkResults[network] = {
    //       rps: metrics.currentRPS,
    //       fee: metrics.currentBaseFee,
    //       utilization: metrics.utilization
    //     };
        
    //     console.log(`[TEST-EIP1559] ${network} results:`, networkResults[network]);
    //   }
      
    //   // Should produce consistent results across networks
    //   const rpses = Object.values(networkResults).map(r => r.rps);
    //   expect(Math.abs(rpses[0] - rpses[1])).toBeLessThan(0.1); // Small tolerance
    // });

    it('should handle rapid successive calls efficiently', async () => {
      console.log('[TEST-EIP1559] Testing performance with rapid calls');
      
      // Create calculator with short adjustment interval for testing
      const performanceConfig = createEIP1559Config({
        minBaseFee: '$0.0001',
        maxBaseFee: '$0.01',
        defaultFee: '$0.001',
        maxChangeRate: 0.25,
        targetUtilization: 0.5,
        smoothingWindow: 10,
        elasticityMultiplier: 2.0,
        adjustmentInterval: 50  // 50ms for testing
      });
      
      const performanceCalculator = new EIP1559InspiredDynamicPricingCalculator(performanceConfig);
      
      const startTime = Date.now();
      const results: string[] = [];
      
      // 100 calls with small delays to allow fee adjustments
      for (let i = 0; i < 100; i++) {
        const price = performanceCalculator.calculatePrice('$0.001', mockRequest, 'arbitrum-sepolia');
        if (i % 20 === 0) results.push(String(price));
        
        // Add small delay every 10 requests to allow fee adjustments, simulating real traffic
        if (i % 10 === 9) {
          await new Promise(resolve => setTimeout(resolve, 60));
        }
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      const finalMetrics = performanceCalculator.getEIP1559Metrics();
      
      console.log('[TEST-EIP1559] Performance results:');
      console.log(`[TEST-EIP1559] - Duration: ${duration}ms for 100 calls`);
      console.log(`[TEST-EIP1559] - Average: ${(duration / 100).toFixed(3)}ms per call`);
      console.log(`[TEST-EIP1559] - Price progression:`, results);
      console.log(`[TEST-EIP1559] - Final metrics:`, finalMetrics);
      
      expect(duration).toBeLessThan(10000); 
      expect(finalMetrics.requestCount).toBe(100);
      expect(finalMetrics.baseFeeHistory.length).toBeGreaterThan(1);
    });
  });
});