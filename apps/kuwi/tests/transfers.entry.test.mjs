import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalTransferRate,
  normalizeTransferInput,
  parseTransferAmount,
  parseTransferFee,
  parseTransferRate,
  receivedAmountFromRate,
  rateFromReceivedAmount,
} from "../src/transfers/entry.ts";

test("source, received, and fee inputs use their own currency precision", () => {
  assert.equal(parseTransferAmount("100.00", 2), 10000);
  assert.equal(parseTransferAmount("14987", 0), 14987);
  assert.equal(parseTransferAmount("1.809", 2), null);
  assert.equal(parseTransferAmount("0", 2), null);
  assert.equal(parseTransferFee("", 2), 0);
  assert.equal(parseTransferFee("1.23", 2), 123);
  assert.equal(parseTransferFee("1.001", 2), null);
  assert.equal(normalizeTransferInput("1.809", 2), "1.80");
  assert.equal(normalizeTransferInput("14987.9", 0), "14987");
});

test("rate calculation truncates received currency precision before storing minor units", () => {
  assert.equal(receivedAmountFromRate(10000, 2, 149.8765, 0), 14987);
  assert.equal(receivedAmountFromRate(100000, 2, 0.0184567, 2), 1845);
});

test("manual received amount derives a canonical positive JavaScript rate", () => {
  const rate = rateFromReceivedAmount(100000, 2, 1846, 2);
  assert.equal(rate, 0.01846);
  assert.equal(canonicalTransferRate(rate), "0.01846");
});

test("rate input accepts arbitrary finite precision and rejects invalid values", () => {
  assert.equal(parseTransferRate("149.87650000000001"), 149.87650000000001);
  assert.equal(parseTransferRate("0"), null);
  assert.equal(parseTransferRate("Infinity"), null);
  assert.equal(parseTransferRate("1,000"), null);
});

test("rate calculation truncates the converted number's decimal text to destination precision", () => {
  assert.equal(receivedAmountFromRate(100, 2, 0.29, 2), 29);
  assert.equal(receivedAmountFromRate(300, 2, 0.29, 2), 86);
});
