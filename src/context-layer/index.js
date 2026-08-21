'use strict';

const { validateScopedContextBundle } = require('./bundle');
const { createScopedContextAccessor } = require('./accessor');
const {
  FileReceiptStore,
  InMemoryReceiptStore,
  createReceipt,
  validateReceipt,
} = require('./receipts');
const {
  createMemoryUpdateProposal,
  validateMemoryUpdateProposal,
} = require('./memory');
const {
  assertNoSecretFields,
  digestValue,
  findSecretFields,
} = require('./utils');

module.exports = {
  FileReceiptStore,
  InMemoryReceiptStore,
  assertNoSecretFields,
  createMemoryUpdateProposal,
  createReceipt,
  createScopedContextAccessor,
  digestValue,
  findSecretFields,
  validateMemoryUpdateProposal,
  validateReceipt,
  validateScopedContextBundle,
};
