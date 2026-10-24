// node --test test/  — code-in-description claim: HMAC binding, expiry, wrong channel, wrong key, tamper.
import test from 'node:test';
import assert from 'node:assert/strict';
import { issueCode, verifyCode, openTicket, CODE_TTL } from '../api/claim/_code.js';

const S = 'x'.repeat(40), K = '02' + 'a'.repeat(64), K2 = '03' + 'b'.repeat(64);
const CH = 'UC' + 'A'.repeat(22), CH2 = 'UC' + 'B'.repeat(22), T0 = 1_760_000_000_000;
const issue = (o = {}) => issueCode(S, { identityKey: K, channelId: CH, now: T0, ...o });

test('code looks like bvx-xxxxxxxx and is deterministic for key+channel+time', () => {
  const a = issue(), b = issue();
  assert.match(a.code, /^bvx-[2-9a-hjkmnp-z]{8}$/);
  assert.equal(a.code, b.code);
  assert.notEqual(a.code, issue({ identityKey: K2 }).code);
  assert.notEqual(a.code, issue({ channelId: CH2 }).code);
  assert.notEqual(a.code, issue({ now: T0 + 1 }).code);
  assert.equal(a.expiresAt, T0 + CODE_TTL);
});

test('verifies when the code is anywhere in the description (any case)', () => {
  const { code, ticket } = issue();
  const r = verifyCode(S, { ticket, identityKey: K, channelId: CH, description: `Hello\nmy channel ${code.toUpperCase()} thanks`, now: T0 + 60_000 });
  assert.equal(r.ok, true); assert.equal(r.channelId, CH);
});

test('missing code -> missing (the "Saved? press Check again" case)', () => {
  const { ticket } = issue();
  assert.equal(verifyCode(S, { ticket, identityKey: K, channelId: CH, description: 'old description', now: T0 }).reason, 'missing');
});

test('expires after 30 minutes', () => {
  const { code, ticket } = issue();
  assert.equal(verifyCode(S, { ticket, identityKey: K, channelId: CH, description: code, now: T0 + CODE_TTL }).ok, true);
  assert.equal(verifyCode(S, { ticket, identityKey: K, channelId: CH, description: code, now: T0 + CODE_TTL + 1 }).reason, 'expired');
});

test('wrong wallet key cannot use the ticket or the code it sees in the description', () => {
  const { code, ticket } = issue();
  assert.equal(verifyCode(S, { ticket, identityKey: K2, channelId: CH, description: code, now: T0 }).ok, false);
  // attacker gets their own ticket for the same channel: the owner's public code doesn't match theirs
  const mine = issue({ identityKey: K2, now: T0 + 5 });
  assert.equal(verifyCode(S, { ticket: mine.ticket, identityKey: K2, channelId: CH, description: code, now: T0 + 10 }).reason, 'missing');
});

test('wrong channel is refused, and a ticket edited to another channel fails the HMAC', () => {
  const { code, ticket } = issue();
  assert.equal(verifyCode(S, { ticket, identityKey: K, channelId: CH2, description: code, now: T0 }).reason, 'channel');
  const forged = ticket.replace(CH, CH2);
  assert.equal(openTicket(S, forged, K, T0).reason, 'bad');
  const later = ticket.replace(String(T0), String(T0 + CODE_TTL));
  assert.equal(openTicket(S, later, K, T0 + CODE_TTL + 5).reason, 'bad');
});

test('a different server secret rejects the ticket', () => {
  const { code, ticket } = issue();
  assert.equal(verifyCode('y'.repeat(40), { ticket, identityKey: K, channelId: CH, description: code, now: T0 }).ok, false);
});
