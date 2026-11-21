#!/usr/bin/env node
'use strict';

/**
 * Prints a new VAPID key pair for browser push (Phase 14). Set them on the server as
 * VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, with VAPID_SUBJECT=mailto:<operations address>.
 * The private key is a secret: put it straight into the host's environment settings, never in git.
 * Changing the pair later invalidates existing browser subscriptions (members turn push on again).
 */

const { generateVapidKeys } = require('../lib/communication/web-push');

const keys = generateVapidKeys();
process.stdout.write(`VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=mailto:you@example.com\n`);
