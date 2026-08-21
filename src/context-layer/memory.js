'use strict';

const crypto = require('node:crypto');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const schema = require('../../schemas/context-layer/memory-update-proposal.schema.json');
const {
  SPEC_VERSION,
  assertName,
  assertNoSecretFields,
  cloneJson,
  contextError,
  deepFreeze,
  isPlainObject,
  safeAjvErrors,
  toRfc3339,
} = require('./utils');

const INPUT_KEYS = new Set([
  'id',
  'issuer',
  'subjectRef',
  'operation',
  'proposedClaims',
  'provenanceRefs',
  'rationale',
  'submittedBy',
  'approvalRequirement',
  'createdAt',
]);
const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

function createMemoryUpdateProposal(input) {
  if (!isPlainObject(input)) {
    throw contextError(
      'INVALID_MEMORY_PROPOSAL_INPUT',
      'Memory proposal input must be an object.',
      { status: 422 },
    );
  }
  for (const key of Object.keys(input)) {
    if (!INPUT_KEYS.has(key)) {
      throw contextError(
        'INVALID_MEMORY_PROPOSAL_INPUT',
        'Memory proposal input contains an unsupported field: ' + key + '.',
        { status: 422 },
      );
    }
  }
  assertNoSecretFields(input, 'memory proposal input');

  const submittedBy = requireIdentifier(input.submittedBy, 'submittedBy');
  const issuer = requireIdentifier(input.issuer || submittedBy, 'issuer');
  const subjectRef = requireIdentifier(input.subjectRef, 'subjectRef');
  const operation = assertName(
    input.operation || 'add_or_contradict',
    'memory proposal operation',
  );
  const provenanceRefs = input.provenanceRefs === undefined
    ? []
    : cloneJson(input.provenanceRefs, 'provenanceRefs');
  const requirements = Array.isArray(input.approvalRequirement)
    ? [...input.approvalRequirement]
    : [];

  addUnique(requirements, 'user_confirm');
  if (provenanceRefs.length === 0) addUnique(requirements, 'source_required');

  return validateProposalDocument({
    spec_version: SPEC_VERSION,
    type: 'memory_update_proposal',
    id: input.id || 'urn:cl:proposal:' + crypto.randomUUID(),
    created_at: toRfc3339(input.createdAt, 'memory proposal createdAt'),
    issuer: { id: issuer },
    subject_ref: subjectRef,
    operation,
    proposed_claims: cloneJson(input.proposedClaims, 'proposedClaims'),
    provenance_refs: provenanceRefs,
    rationale: input.rationale,
    submitted_by: submittedBy,
    status: 'pending_validation',
    approval_requirement: requirements,
  });
}

function validateMemoryUpdateProposal(proposal) {
  const candidate = validateProposalDocument(proposal);
  const provenanceComplete = candidate.provenance_refs.length > 0;
  if (
    !candidate.approval_requirement.includes('user_confirm')
    || (
      !provenanceComplete
      && !candidate.approval_requirement.includes('source_required')
    )
  ) {
    throw contextError(
      'MEMORY_PROPOSAL_APPROVAL_INCOMPLETE',
      'Pending memory proposals require user approval and missing provenance requires a source.',
      { status: 422 },
    );
  }
  return Object.freeze({
    valid: true,
    proposal: candidate,
    pending: true,
    provenanceComplete,
    requiresSource: !provenanceComplete,
    requiresUserApproval: true,
  });
}

function validateProposalDocument(proposal) {
  if (!isPlainObject(proposal)) {
    throw contextError(
      'INVALID_MEMORY_UPDATE_PROPOSAL',
      'Memory update proposal must be a JSON object.',
      { status: 422 },
    );
  }
  assertNoSecretFields(proposal, 'memory update proposal');
  const candidate = cloneJson(proposal, 'memory update proposal');
  if (!validateSchema(candidate)) {
    throw contextError(
      'INVALID_MEMORY_UPDATE_PROPOSAL',
      'Memory update proposal does not match the pending proposal contract.',
      { status: 422, details: safeAjvErrors(validateSchema.errors) },
    );
  }
  return deepFreeze(candidate);
}

function requireIdentifier(value, label) {
  if (typeof value !== 'string' || value.length < 3 || value.length > 512) {
    throw contextError(
      'INVALID_IDENTIFIER',
      label + ' must be a stable identifier.',
      { status: 422 },
    );
  }
  return value;
}

function addUnique(values, entry) {
  if (!values.includes(entry)) values.push(entry);
}

module.exports = {
  createMemoryUpdateProposal,
  validateMemoryUpdateProposal,
};
