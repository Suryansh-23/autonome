# Express Middleware SDK Documentation

A sophisticated Express.js middleware package that provides bot detection, x402 payment integration, and dynamic pricing capabilities using EIP-1559 inspired algorithms.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Middleware](#core-middleware)
  - [Main Middleware](#main-middleware)
  - [Header Middleware](#header-middleware)
- [Dynamic Pricing](#dynamic-pricing)
  - [EIP1559 Algorithm](#eip1559-algorithm)
  - [Configuration](#configuration)
  - [Metrics & Monitoring](#metrics--monitoring)
- [Integration Examples](#integration-examples)
- [API Reference](#api-reference)
- [Testing](#testing)

## Installation

```bash
npm install middleware-sdk-express
```

## Quick Start

```typescript
import express from 'express';
import { 
  middleware, 
  EIP1559InspiredDynamicPricingCalculator, 
  createEIP1559Config 
} from 'middleware-sdk-express';

const app = express();

// Create dynamic pricing calculator
const eip1559Calculator = new EIP1559InspiredDynamicPricingCalculator(
  createEIP1559Config({
    minBaseFee: "$0.0005",
    maxBaseFee: "$0.02",
    defaultFee: "$0.001"
  })
);

// Apply middleware
app.use(middleware(
  '0x742d35Cc6532C4532CE' as `0x${string}`, // payTo address
  {
    '/api/protected': { 
      price: '$0.001',
      network: 'arbitrum-sepolia'
    }
  },
  { url: 'https://facilitator.example.com' },
  undefined,
  eip1559Calculator.calculatePrice
));

app.listen(3000);
```

## Core Middleware

### Main Middleware

The primary middleware function that integrates bot detection with x402 payment processing and dynamic pricing.

#### Function Signature

```typescript
function middleware(
  payTo: Address,
  routes: RoutesConfig,
  facilitator?: FacilitatorConfig,
  paywall?: PaywallConfig,
  dynamicPricingConfig?: DynamicPricingConfig | DynamicPriceCalculator
): (req: Request, res: Response, next: NextFunction) => void
```

#### Parameters

- **`payTo`** (required): `Address` - EVM address where payments will be sent
- **`routes`** (required): `RoutesConfig` - Configuration for protected routes
- **`facilitator`** (optional): `FacilitatorConfig` - Facilitator service configuration
- **`paywall`** (optional): `PaywallConfig` - Custom paywall configuration
- **`dynamicPricingConfig`** (optional): `DynamicPricingConfig | DynamicPriceCalculator` - Dynamic pricing configuration or calculator function

#### Route Configuration

```typescript
type RoutesConfig = {
  [path: string]: {
    price: string;           // Base price (e.g., "$0.001")
    network: Network;        // Blockchain network
    config?: {
      description?: string;  // Route description
      [key: string]: any;   // Additional metadata
    };
  };
};
```

#### Example Usage

```typescript
// Basic usage with static pricing
app.use(middleware(
  payTo,
  {
    '/api/data': { 
      price: '$0.001', 
      network: 'arbitrum-sepolia' 
    }
  }
));

// With facilitator
app.use(middleware(
  payTo,
  routes,
  { url: 'https://facilitator.example.com' }
));

// With dynamic pricing
app.use(middleware(
  payTo,
  routes,
  facilitator,
  undefined,
  eip1559Calculator.calculatePrice
));
```

#### Behavior

1. **Bot Detection**: Analyzes incoming requests to identify bot traffic
2. **Conditional Payment**: 
   - Human users: Pass through without payment
   - Bot traffic: Require x402 payment
3. **Dynamic Pricing**: Adjusts prices based on traffic patterns (if configured)

### Header Middleware

A utility middleware for setting EVM address headers in responses.

#### Function Signature

```typescript
function setHeaderMiddleware(
  evmAddress: string, 
  res: Response, 
  next: NextFunction
): void
```

#### Parameters

- **`evmAddress`** (required): `string` - EVM address to set in response header
- **`res`** (required): `Response` - Express response object
- **`next`** (required): `NextFunction` - Express next function

#### Usage

```typescript
app.use((req, res, next) => {
  setHeaderMiddleware('0x742d35Cc6532C4532CE', res, next);
});

// Or as route-specific middleware
app.get('/api/address', 
  (req, res, next) => setHeaderMiddleware(userAddress, res, next),
  (req, res) => res.json({ message: 'Address set in header' })
);
```

## Dynamic Pricing

### EIP1559 Algorithm

The `EIP1559InspiredDynamicPricingCalculator` implements a sophisticated pricing algorithm based on Ethereum's EIP-1559 fee mechanism.

#### Key Features

- **Utilization-Based Pricing**: Adjusts fees based on network utilization
- **Request Rate Smoothing**: Uses time-bucketed RPS tracking for stability
- **Configurable Parameters**: Fully customizable algorithm parameters
- **Real-time Metrics**: Comprehensive monitoring and metrics export
- **Fee Bounds**: Enforced minimum and maximum fee limits

#### Algorithm Overview

```typescript
// Utilization calculation
utilization = currentRPS / targetRPS

// Fee adjustment based on utilization
if (utilization > 1.0) {
  // Over capacity - increase fee
  newFee = currentFee * (1 + adjustmentRate)
} else if (utilization < targetUtilization) {
  // Under utilized - decrease fee  
  newFee = currentFee * (1 - adjustmentRate)
}

// Apply bounds and rate limits
newFee = Math.max(minFee, Math.min(maxFee, newFee))
```

### Configuration

#### Creating Configuration

```typescript
import { createEIP1559Config } from 'middleware-sdk-express';

const config = createEIP1559Config({
  minBaseFee: "$0.0005",         // Minimum fee (5 cents)
  maxBaseFee: "$0.02",           // Maximum fee (2 cents)  
  defaultFee: "$0.001",          // Starting fee (1 cent)
  maxChangeRate: 0.125,          // 12.5% max change per adjustment
  targetUtilization: 0.6,        // Target 60% utilization
  smoothingWindow: 20,           // 20 data points for RPS smoothing
  elasticityMultiplier: 1.5,     // 1.5x elasticity factor
  adjustmentInterval: 10000      // 10 second adjustment intervals
});
```

#### Configuration Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `minBaseFee` | `string` | `"$0.0001"` | Minimum allowable fee |
| `maxBaseFee` | `string` | `"$0.01"` | Maximum allowable fee |
| `defaultFee` | `string` | `"$0.001"` | Initial base fee |
| `maxChangeRate` | `number` | `0.125` | Maximum fee change per adjustment (12.5%) |
| `targetUtilization` | `number` | `0.5` | Target utilization ratio (50%) |
| `smoothingWindow` | `number` | `30` | Number of data points for RPS smoothing |
| `elasticityMultiplier` | `number` | `2.0` | Elasticity factor for fee adjustments |
| `adjustmentInterval` | `number` | `10000` | Time between fee adjustments (ms) |

#### Calculator Initialization

```typescript
const calculator = new EIP1559InspiredDynamicPricingCalculator(config);

// Use in middleware
app.use(middleware(
  payTo,
  routes,
  facilitator,
  undefined,
  calculator.calculatePrice  // Pass the calculator function
));
```

### Metrics & Monitoring

#### Getting Metrics

```typescript
const metrics = calculator.getEIP1559Metrics();

console.log(metrics);
// Output:
{
  currentRPS: 12,
  targetRPS: 10,
  utilization: "120.0%",
  currentBaseFee: "$0.0012",
  requestCount: 847,
  activeSeconds: 42,
  historySize: 25,
  baseFeeHistory: ["$0.0010", "$0.0011", "$0.0012"],
  lastAdjustment: "2025-09-16T10:30:45.123Z"
}
```

#### Metrics Explanation

- **`currentRPS`**: Current requests per second
- **`targetRPS`**: Target RPS based on configuration
- **`utilization`**: Current utilization percentage
- **`currentBaseFee`**: Current base fee amount
- **`requestCount`**: Total requests in current window
- **`activeSeconds`**: Number of active time buckets
- **`historySize`**: Size of RPS history buffer
- **`baseFeeHistory`**: Recent fee adjustment history
- **`lastAdjustment`**: Timestamp of last fee adjustment

#### Metrics Endpoint Example

```typescript
app.get('/metrics', (req, res) => {
  res.json({
    eip1559: calculator.getEIP1559Metrics(),
    timestamp: new Date().toISOString(),
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage()
    }
  });
});
```

#### Runtime Configuration Updates

```typescript
// Update configuration at runtime
calculator.updateConfig({
  targetUtilization: 0.8,  // Increase target to 80%
  maxChangeRate: 0.15      // Increase max change rate
});

// Reset calculator state
calculator.reset();

// Force immediate fee adjustment (for testing)
calculator.forceAdjustment();
```

## Integration Examples

### Complete Server Setup

```typescript
import express from 'express';
import { 
  middleware, 
  setHeaderMiddleware,
  EIP1559InspiredDynamicPricingCalculator, 
  createEIP1559Config,
  Resource 
} from 'middleware-sdk-express';
import cors from "cors";
import { config } from 'dotenv';

config();
const app = express();
app.use(express.json());
app.use(cors());

// Environment variables
const facilitatorURL = process.env.FACILITATOR_URL as Resource;
const payTo = process.env.ADDRESS as `0x${string}`;

if (!payTo || !facilitatorURL) {
  console.error("Missing required environment variables");
  process.exit(1);
}

// Create EIP1559 pricing calculator
const eip1559Calculator = new EIP1559InspiredDynamicPricingCalculator(
  createEIP1559Config({
    minBaseFee: "$0.0005",      // 0.5 cent minimum
    maxBaseFee: "$0.02",        // 2 cents maximum  
    defaultFee: "$0.001",       // 1 cent starting point
    maxChangeRate: 0.125,       // 12.5% max change per adjustment
    targetUtilization: 0.6,     // Target 60% utilization
    smoothingWindow: 20,        // 20 data points for smoothing
    elasticityMultiplier: 1.5,  // 1.5x elasticity
    adjustmentInterval: 10000   // 10 second intervals
  })
);

// Apply main middleware with EIP1559 dynamic pricing
app.use(middleware(
  payTo, 
  {
    '/api/protected': { 
      price: '$0.001',              
      network: 'arbitrum-sepolia',
      config: {
        description: 'Protected API with EIP1559 dynamic pricing'
      }
    },
    '/api/premium': {
      price: '$0.005',
      network: 'arbitrum-sepolia',
      config: {
        description: 'Premium API endpoint'
      }
    }
  },
  {
    url: facilitatorURL,
  },
  undefined, 
  eip1559Calculator.calculatePrice // Dynamic pricing function
));

// Protected route
app.get('/api/protected', (req, res) => {
  res.json({ 
    message: "Access granted with EIP1559 pricing!",
    metrics: eip1559Calculator.getEIP1559Metrics()
  });
});

// Public route
app.get('/api/public', (req, res) => {
  res.json({ message: "This is a public route" });
});

// Metrics endpoint
app.get('/api/metrics', (req, res) => {
  res.json({
    eip1559: eip1559Calculator.getEIP1559Metrics(),
    timestamp: new Date().toISOString()
  });
});

// Admin endpoints
app.post('/admin/reset', (req, res) => {
  calculator.reset();
  res.json({ message: "EIP1559 state reset successfully" });
});

app.post('/admin/config', (req, res) => {
  try {
    calculator.updateConfig(req.body);
    res.json({ 
      message: "Configuration updated successfully",
      newMetrics: calculator.getEIP1559Metrics()
    });
  } catch (error) {
    res.status(400).json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

// Header middleware example
app.use('/api/user', (req, res, next) => {
  setHeaderMiddleware(payTo, res, next);
});

app.listen(3002, () => {
  console.log(`Server running at http://localhost:3002`);
  console.log(`Protected: http://localhost:3002/api/protected`);
  console.log(`Metrics: http://localhost:3002/api/metrics`);
});
```

### Testing Dynamic Pricing

```bash
# Test protected endpoint
curl http://localhost:3002/api/protected

# View metrics
curl http://localhost:3002/api/metrics

# Load test to trigger dynamic pricing
for i in {1..20}; do
  curl http://localhost:3002/api/protected &
done

# Check metrics after load
curl http://localhost:3002/api/metrics
```

## API Reference

### Types

```typescript
// Core types
type Address = `0x${string}`;
type Network = 'arbitrum-sepolia' | 'base-sepolia' | string;
type Price = string | number;

// Configuration types
interface RoutesConfig {
  [path: string]: {
    price: string;
    network: Network;
    config?: Record<string, any>;
  };
}

interface FacilitatorConfig {
  url: string;
  [key: string]: any;
}

interface EIP1559InspiredConfig {
  minBaseFee: string;
  maxBaseFee: string;
  defaultFee: string;
  maxChangeRate: number;
  targetUtilization: number;
  smoothingWindow: number;
  elasticityMultiplier: number;
  adjustmentInterval: number;
}

// Metrics type
interface EIP1559Metrics {
  currentRPS: number;
  targetRPS: number;
  utilization: string;
  currentBaseFee: string;
  requestCount: number;
  activeSeconds: number;
  historySize: number;
  baseFeeHistory: string[];
  lastAdjustment: string;
}
```

### Calculator Methods

```typescript
class EIP1559InspiredDynamicPricingCalculator {
  constructor(config: EIP1559InspiredConfig);
  
  // Main pricing function
  calculatePrice(originalPrice: Price, req: Request, network: Network): Price;
  
  // Get current metrics
  getEIP1559Metrics(): EIP1559Metrics;
  
  // Runtime configuration
  updateConfig(updates: Partial<EIP1559InspiredConfig>): void;
  
  // Reset state
  reset(): void;
  
  // Force immediate adjustment (testing)
  forceAdjustment(): void;
}
```

## Testing

The package includes comprehensive test suites for all functionality.

### Running Tests

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run specific test file
npm test tests/EIP1559InspiredDynamicPricingCalculator.test.ts

# Run with verbose output
npm test -- --reporter=verbose
```

### Test Coverage

The test suite covers:

- ✅ **Configuration & Initialization**: Default and custom configurations
- ✅ **Request Recording**: RPS tracking and bucketing
- ✅ **Fee Adjustments**: Over/under capacity scenarios
- ✅ **Rate Limiting**: Maximum change rate enforcement
- ✅ **Bounds Checking**: Min/max fee limits
- ✅ **Metrics Export**: Comprehensive monitoring
- ✅ **Runtime Updates**: Configuration changes and resets
- ✅ **Performance**: Rapid request handling
- ✅ **Edge Cases**: Zero targets, network consistency

### Example Test Scenarios

```typescript
// Test fee increase under load
it('should increase fee when over capacity', async () => {
  // Generate high RPS (12 requests to target of 10)
  for (let i = 0; i < 12; i++) {
    calculator.calculatePrice('$0.001', mockRequest, 'arbitrum-sepolia');
  }
  
  // Wait for adjustment interval
  await new Promise(resolve => setTimeout(resolve, 60));
  
  // Verify fee increased
  const metrics = calculator.getEIP1559Metrics();
  expect(parseFloat(metrics.currentBaseFee.replace('$', '')))
    .toBeGreaterThan(0.001);
});

// Test RPS bucketing
it('should implement bucketing correctly', () => {
  // 8 rapid requests in same second
  for (let i = 0; i < 8; i++) {
    calculator.calculatePrice('$0.001', mockRequest, 'arbitrum-sepolia');
  }
  
  const metrics = calculator.getEIP1559Metrics();
  expect(metrics.currentRPS).toBe(8);
  expect(metrics.utilization).toBe('80.0%');
  expect(metrics.activeSeconds).toBe(1);
});
```

### Performance Benchmarks

Based on test results:

- **Throughput**: 100 requests processed in ~600ms (6ms per request)
- **Memory Efficiency**: Time-bucketed storage vs individual timestamps
- **Fee Adjustment**: Real-time utilization-based pricing
- **Stability**: Smoothed RPS prevents pricing volatility

## Advanced Configuration

### Production Recommendations

```typescript
// Production configuration
const prodConfig = createEIP1559Config({
  minBaseFee: "$0.0001",          // 0.01 cent minimum
  maxBaseFee: "$0.05",            // 5 cent maximum
  defaultFee: "$0.001",           // 0.1 cent default
  maxChangeRate: 0.125,           // 12.5% standard rate
  targetUtilization: 0.7,         // 70% target utilization
  smoothingWindow: 60,            // 1 minute smoothing
  elasticityMultiplier: 2.0,      // Standard elasticity
  adjustmentInterval: 30000       // 30 second intervals
});
```

### Load Balancing Considerations

```typescript
// For load-balanced deployments, consider external state storage
class DistributedEIP1559Calculator extends EIP1559InspiredDynamicPricingCalculator {
  // Implement Redis or database state synchronization
  // for consistent pricing across multiple instances
}
```

### Monitoring & Alerting

```typescript
// Set up monitoring for key metrics
setInterval(() => {
  const metrics = calculator.getEIP1559Metrics();
  
  // Alert on high utilization
  if (parseFloat(metrics.utilization) > 150) {
    console.warn(`High utilization: ${metrics.utilization}`);
  }
  
  // Alert on fee ceiling
  const currentFee = parseFloat(metrics.currentBaseFee.replace('$', ''));
  const maxFee = 0.05; // $0.05
  if (currentFee > maxFee * 0.9) {
    console.warn(`Approaching max fee: ${metrics.currentBaseFee}`);
  }
}, 10000);
```

---

## Support

For issues, questions, or contributions, please refer to the project repository or documentation.

### Environment Variables

```bash
# Required
FACILITATOR_URL=https://your-facilitator.com
ADDRESS=0x742d35Cc6532C4532CE6c97395c4532CE

# Optional
PORT=3002
NODE_ENV=production
```

### Common Issues

1. **Module Not Found**: Ensure all dependencies are installed with `npm install`
2. **Type Errors**: Verify TypeScript configuration and type imports
3. **Payment Failures**: Check facilitator URL and network configuration
4. **High Memory Usage**: Consider reducing `smoothingWindow` for high-traffic applications

This documentation provides comprehensive coverage of the middleware SDK. For specific implementation details, refer to the source code and test files.