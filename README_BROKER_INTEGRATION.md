# Broker API Integration Guide

## Overview

ForexOrbit Academy now supports broker-provided demo trading via API integration. This allows students to practice trading with real market data using paper trading accounts.

## Architecture

The system uses a modular broker abstraction layer that allows easy swapping of brokers:

- **Base Broker Interface** (`lib/brokers/base-broker.ts`): Abstract class defining broker operations
- **Broker Factory** (`lib/brokers/broker-factory.ts`): Creates broker instances based on configuration
- **OANDA Implementation** (`lib/brokers/oanda-broker.ts`): OANDA demo API integration
- **Performance Metrics** (`lib/performance-metrics.ts`): Calculates trading performance

## Security & Compliance

### Critical Security Measures

1. **Demo Mode Only**: The system enforces demo/paper trading mode only
   - `BROKER_DEMO_MODE` environment variable must be `true` in production
   - All broker instances are created with `isDemo: true`
   - Real trading accounts are rejected

2. **No Real Money**: 
   - No deposit functionality
   - No withdrawal functionality
   - All trades use virtual money only

3. **Environment Variable Security**:
   - API keys stored in environment variables only
   - Never exposed to client-side code
   - Validated on server-side only

### Compliance Disclaimers

All trading interfaces display clear disclaimers:
- Demo/paper trading only
- No brokerage services provided
- Educational purposes only
- Trading involves substantial risk

## Environment Variables

### Required for OANDA Integration

```env
# Broker Configuration
BROKER_TYPE=oanda
BROKER_DEMO_MODE=true  # CRITICAL: Must be true

# OANDA API Credentials
OANDA_API_KEY=your_oanda_practice_api_key
OANDA_ACCOUNT_ID=your_oanda_practice_account_id
OANDA_DEMO_URL=https://api-fxpractice.oanda.com
```

### Getting OANDA Credentials

1. Sign up for OANDA practice account: https://hub.oanda.com/apply/demo/
2. Create a practice account
3. Generate API token from OANDA account settings
4. Get your practice account ID
5. Add credentials to environment variables

## API Endpoints

### Account Management

- `GET /api/demo-trading/account` - Get student's demo account
- `POST /api/demo-trading/account` - Create demo account for student

### Trading Operations

- `GET /api/demo-trading/trades` - Get open positions and order history
- `POST /api/demo-trading/trades` - Place a new order
- `POST /api/demo-trading/positions/[positionId]/close` - Close a position

### Performance

- `GET /api/demo-trading/performance` - Get trading performance metrics

## Performance Metrics

The system tracks:

- **Win Rate**: Percentage of winning trades
- **Net Profit**: Total profit/loss
- **Max Drawdown**: Largest peak-to-trough decline
- **Risk/Reward Ratio**: Average win vs average loss
- **Consistency Score**: Variance in results (0-100)
- **Risk Management Score**: Use of stop loss, position sizing (0-100)

## Adding New Brokers

To add a new broker (e.g., FXCM):

1. Create a new broker class extending `BaseBroker`:
   ```typescript
   export class FxcmBroker extends BaseBroker {
     // Implement all abstract methods
   }
   ```

2. Add to `BrokerFactory`:
   ```typescript
   case 'fxcm':
     return new FxcmBroker(apiKey, accountId);
   ```

3. Update environment variables:
   ```env
   BROKER_TYPE=fxcm
   FXCM_API_KEY=...
   ```

## Database Collections

- `demoAccounts`: Stores student demo account information
- `demoTrades`: Stores trade history (for performance tracking)

## Testing

Before deploying:

1. Verify `BROKER_DEMO_MODE=true` in production
2. Test account creation
3. Test order placement
4. Verify all trades are demo only
5. Check performance metrics calculation
6. Verify security disclaimers are displayed

## Limitations

- Currently supports OANDA demo API only
- FXCM and other brokers can be added via the modular architecture
- Real-time price updates require broker API support
- Some features may vary by broker

## Support

For issues or questions:
- Check broker API documentation
- Verify environment variables are set correctly
- Ensure demo mode is enabled
- Review error logs for API responses

