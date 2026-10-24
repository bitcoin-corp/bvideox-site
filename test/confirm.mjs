// confirmOnChain: "Done" only once the network shows the tx. Offline (fetch is faked). Usage: node test/confirm.mjs
import assert from 'node:assert/strict';
import { confirmOnChain, notOnChain, runMint } from '../mint/records.js';

const TX = 'b6963e8c3bb87bf0609e607017748fe578ff3b3920811630fdb26d9897ec3a23';
const wait = async () => {};
const res = (ok, body) => ({ ok, json: async () => body });
// unknown everywhere (the 24 Oct mint): false after the short retry
let calls = 0;
assert.equal(await confirmOnChain(TX, { wait, fetchFn: async () => (calls++, res(false)) }), false);
assert.ok(calls >= 12);
// WoC knows it
assert.equal(await confirmOnChain(TX, { wait, fetchFn: async (u) => res(u.includes('whatsonchain')) }), true);
// ARC says seen; ARC "RECEIVED" alone is not enough
assert.equal(await confirmOnChain(TX, { wait, fetchFn: async (u) => u.includes('arc') ? res(true, { txStatus: 'SEEN_ON_NETWORK' }) : res(false) }), true);
assert.equal(await confirmOnChain(TX, { wait, fetchFn: async (u) => u.includes('arc') ? res(true, { txStatus: 'RECEIVED' }) : res(false) }), false);
assert.equal(await confirmOnChain('nope', { wait, fetchFn: async () => res(true) }), false);
assert.equal(notOnChain(TX).code, 'NOT_ON_CHAIN');

// runMint never saves a batch the network doesn't show
const wallet = { encrypt: async () => ({ ciphertext: [1, 2, 3] }), createAction: async () => ({ txid: TX }) };
let saved = 0;
await assert.rejects(runMint({ wallet, channel: { channelId: 'c', slug: 's' }, videos: [{ id: 'v1', title: 't' }], confirm: async () => false, onBatch: () => { saved++; } }), (e) => e.code === 'NOT_ON_CHAIN');
assert.equal(saved, 0);
await runMint({ wallet, channel: { channelId: 'c', slug: 's' }, videos: [{ id: 'v1', title: 't' }], confirm: async () => true, onBatch: () => { saved++; } });
assert.equal(saved, 1);
console.log('confirm.mjs: ok');
