/**
 * Broker Factory
 * Creates broker instances based on configuration
 * Allows easy swapping of brokers
 */

import { BaseBroker } from './base-broker';
import { OandaBroker } from './oanda-broker';

export type BrokerType = 'oanda' | 'fxcm' | 'mock'; // Add more as needed

export class BrokerFactory {
  /**
   * Create a broker instance
   * @param brokerType - Type of broker to create
   * @param accountId - Optional account ID for broker-specific operations
   */
  static createBroker(brokerType: BrokerType = 'oanda', accountId?: string): BaseBroker {
    // CRITICAL: Only allow demo mode
    const isDemo = process.env.NODE_ENV === 'production' 
      ? process.env.BROKER_DEMO_MODE === 'true'
      : true; // Always demo in development

    if (!isDemo) {
      throw new Error('Real trading is not allowed. Only demo accounts are permitted.');
    }

    switch (brokerType) {
      case 'oanda':
        const oandaApiKey = process.env.OANDA_API_KEY;
        if (!oandaApiKey) {
          throw new Error('OANDA_API_KEY environment variable is required');
        }
        return new OandaBroker(oandaApiKey, accountId || process.env.OANDA_ACCOUNT_ID);

      case 'fxcm':
        // TODO: Implement FXCM broker when needed
        throw new Error('FXCM broker not yet implemented');

      case 'mock':
        // TODO: Implement mock broker for testing
        throw new Error('Mock broker not yet implemented');

      default:
        throw new Error(`Unknown broker type: ${brokerType}`);
    }
  }

  /**
   * Get the configured broker type from environment
   */
  static getConfiguredBrokerType(): BrokerType {
    const brokerType = (process.env.BROKER_TYPE || 'oanda').toLowerCase() as BrokerType;
    return brokerType;
  }
}

