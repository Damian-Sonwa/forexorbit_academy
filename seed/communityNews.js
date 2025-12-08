/**
 * Community News Seeder
 * Seeds Forex news feed with sample data
 */

const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config({ path: '.env.local' });

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'Forex_elearning';

const newsItems = [
  {
    title: 'NFP Results: US Non-Farm Payrolls Beat Expectations',
    description: 'The US economy added 250,000 jobs in the latest NFP report, significantly exceeding the forecasted 180,000. Unemployment rate dropped to 3.5%.',
    category: 'NFP',
    content: 'The Non-Farm Payrolls (NFP) report released today showed strong job growth in the US economy. The addition of 250,000 jobs far exceeded market expectations of 180,000, indicating robust economic health. The unemployment rate fell to 3.5%, reaching near-historic lows. This positive data is likely to strengthen the USD against major currency pairs.',
    link: 'https://www.bls.gov/news.release/empsit.nr0.htm',
    createdAt: new Date(),
  },
  {
    title: 'CPI Inflation Data: Consumer Prices Rise 0.3% MoM',
    description: 'US Consumer Price Index increased by 0.3% month-over-month, with year-over-year inflation at 3.2%. Core CPI (excluding food and energy) rose 0.4%.',
    category: 'CPI',
    content: 'The latest CPI data shows continued inflationary pressures in the US economy. The 0.3% monthly increase and 3.2% annual rate suggest that inflation remains above the Federal Reserve\'s 2% target. Core CPI, which excludes volatile food and energy prices, increased by 0.4%, indicating broad-based price increases. This data may influence Fed policy decisions and USD strength.',
    link: 'https://www.bls.gov/cpi/',
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
  },
  {
    title: 'FOMC Meeting: Fed Maintains Interest Rates at 5.25-5.50%',
    description: 'The Federal Open Market Committee decided to keep the federal funds rate unchanged. Fed Chair emphasized data-dependent approach to future rate decisions.',
    category: 'FOMC',
    content: 'In today\'s FOMC meeting, the Federal Reserve announced its decision to maintain the target federal funds rate at 5.25-5.50%. The decision reflects the Fed\'s cautious approach amid mixed economic signals. Fed Chair emphasized that future rate decisions will be data-dependent, with particular attention to inflation trends and labor market conditions. The USD showed minimal movement following the announcement.',
    link: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
  },
  {
    title: 'Forex Market Volatility Alert: EUR/USD Breaks Key Support Level',
    description: 'EUR/USD dropped below 1.0800 support level, reaching a 3-month low. The pair is now trading at 1.0750, down 0.8% on the day.',
    category: 'Market Volatility',
    content: 'The EUR/USD currency pair has broken through a critical support level at 1.0800, triggering increased volatility in the forex market. The pair is currently trading at 1.0750, representing a 0.8% decline on the day and reaching its lowest point in three months. The move is attributed to strengthening USD and concerns about European economic growth. Traders should monitor for potential further downside or support bounce.',
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
  },
  {
    title: 'USD Strength Report: Dollar Index (DXY) Reaches 105.50',
    description: 'The US Dollar Index climbed to 105.50, its highest level in six months. Strong economic data and hawkish Fed stance support USD strength.',
    category: 'USD Index',
    content: 'The US Dollar Index (DXY) has surged to 105.50, marking its highest level in six months. This strength is driven by robust US economic data, including strong employment figures and persistent inflation. The Federal Reserve\'s hawkish stance on interest rates has also contributed to USD appreciation. The index measures the dollar against a basket of major currencies, and its rise indicates broad USD strength across forex markets.',
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
  },
  {
    title: 'GBP/EUR Market Movement: Sterling Gains on BoE Rate Decision',
    description: 'The British Pound strengthened against the Euro following the Bank of England\'s decision to raise interest rates by 25 basis points to 5.50%.',
    category: 'GBP/EUR',
    content: 'The GBP/EUR pair has seen significant movement following the Bank of England\'s latest monetary policy decision. The BoE raised interest rates by 25 basis points to 5.50%, signaling continued commitment to fighting inflation. This move has strengthened the British Pound against the Euro, with GBP/EUR rising to 1.1650. The rate hike reflects the BoE\'s assessment that inflationary pressures remain elevated despite recent declines.',
    createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000), // 4 days ago
  },
  {
    title: 'JPY Weakness: USD/JPY Approaches 150.00 Psychological Level',
    description: 'The Japanese Yen continues to weaken against the US Dollar, with USD/JPY trading near 150.00. Bank of Japan maintains ultra-loose monetary policy.',
    category: 'JPY',
    content: 'The Japanese Yen has continued its decline against the US Dollar, with USD/JPY approaching the psychologically important 150.00 level. The pair is currently trading at 149.85, near its highest point in over a year. The weakness is primarily driven by the Bank of Japan\'s commitment to maintaining ultra-loose monetary policy, in contrast to the Federal Reserve\'s tighter stance. Traders are watching for potential intervention by Japanese authorities if the pair breaks above 150.00.',
    createdAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000), // 6 days ago
  },
  {
    title: 'Economic Calendar Highlights: Key Events This Week',
    description: 'This week\'s economic calendar features US Retail Sales, UK GDP, Eurozone PMI data, and Australian employment figures. Traders should prepare for potential volatility.',
    category: 'Economic Calendar',
    content: 'The upcoming week features several high-impact economic events that could significantly move forex markets. Key releases include US Retail Sales data, UK Q3 GDP figures, Eurozone Manufacturing and Services PMI, and Australian employment statistics. These events are likely to create volatility across major currency pairs. Traders should monitor these releases and adjust their positions accordingly. The economic calendar is available on our platform for detailed timing and forecasts.',
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
  },
  {
    title: 'USD Index (DXY) Changes: Dollar Strengthens on Risk-Off Sentiment',
    description: 'The DXY index rose 0.5% as global risk sentiment turned negative. Safe-haven demand for USD increased amid geopolitical tensions.',
    category: 'USD Index',
    content: 'The US Dollar Index has strengthened by 0.5% as global markets shifted to risk-off sentiment. The move is driven by increased safe-haven demand for the USD amid rising geopolitical tensions and concerns about global economic growth. The DXY, which measures the dollar against six major currencies, reached 105.20. This strength is reflected across major USD pairs, with EUR/USD, GBP/USD, and AUD/USD all declining.',
    createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), // 8 days ago
  },
  {
    title: 'Forex Market Volatility Alert: Major Currency Pairs Experience Sharp Moves',
    description: 'Unusual volatility detected across major forex pairs. EUR/USD, GBP/USD, and USD/JPY all showing 1%+ moves within the trading session.',
    category: 'Market Volatility',
    content: 'The forex market is experiencing heightened volatility today, with several major currency pairs showing sharp movements. EUR/USD has moved over 1%, GBP/USD has seen similar volatility, and USD/JPY is approaching key resistance levels. This increased volatility may be attributed to a combination of economic data releases, central bank communications, and shifting market sentiment. Traders should exercise caution and ensure proper risk management during these volatile conditions.',
    createdAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000), // 9 days ago
  },
];

async function seedCommunityNews() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✓ Connected to MongoDB');

    const db = client.db(DB_NAME);
    const newsCollection = db.collection('communityNews');

    // Clear existing news
    await newsCollection.deleteMany({});
    console.log('✓ Cleared existing news');

    // Insert news items
    const result = await newsCollection.insertMany(newsItems);
    console.log(`✓ Inserted ${result.insertedCount} news items`);

    console.log('✓ Community news seeding completed successfully!');
  } catch (error) {
    console.error('✗ Error seeding community news:', error);
    throw error;
  } finally {
    await client.close();
  }
}

// Run seeder if called directly
if (require.main === module) {
  seedCommunityNews()
    .then(() => {
      console.log('Seeding completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seeding failed:', error);
      process.exit(1);
    });
}

module.exports = { seedCommunityNews };








