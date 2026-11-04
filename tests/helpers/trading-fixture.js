'use strict';

/**
 * TEST-ONLY synthetic quotes for the practice simulator. These are hand-written inputs that make
 * financial results checkable by hand. They are not market data, they carry `testFixture: true`, and
 * lib/trading/market-data.js refuses them when NODE_ENV is production.
 */

const { Decimal128, ObjectId } = require('mongodb');

const START = new Date('2026-03-04T12:00:00.000Z'); // A Wednesday: the market is open.

function fixtureDataset(overrides = {}) {
  return {
    _id: 'test-fixture',
    name: 'TEST FIXTURE: synthetic quotes, not market data',
    testFixture: true,
    active: true,
    instruments: ['EUR_USD', 'GBP_USD', 'AUD_USD', 'USD_JPY', 'USD_CAD', 'USD_CHF'],
    startAt: new Date('2026-01-01T00:00:00.000Z'),
    endAt: new Date('2027-01-01T00:00:00.000Z'),
    replayAnchorAt: new Date('2026-01-01T00:00:00.000Z'), // simulated time = real time unless changed
    maxQuoteAgeSeconds: 120,
    provenance: { source: 'test', sourceUrl: 'test://fixture', retrievedAt: '2026-01-01' },
    licence: { name: 'test', url: 'test://fixture', educationalUse: 'test', storageRights: 'test', redistributionRights: 'test' },
    timeSemantics: { timezone: 'UTC', daylightSaving: 'none' },
    approval: { status: 'approved', approvedBy: 'test', approvedAt: '2026-01-01' },
    ...overrides,
  };
}

function quoteDoc(datasetId, instrument, time, bid, ask) {
  return { _id: new ObjectId(), datasetId, instrument, time: new Date(time), bid: Decimal128.fromString(bid), ask: Decimal128.fromString(ask) };
}

/** Anchors the replay so that simulated time equals `simNow` at real time `realNow`. */
function anchorFor(dataset, simNow, realNow) {
  return new Date(new Date(dataset.startAt).getTime() + (realNow.getTime() - simNow.getTime()));
}

module.exports = { START, anchorFor, fixtureDataset, quoteDoc };
