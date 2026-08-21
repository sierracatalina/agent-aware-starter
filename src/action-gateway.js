'use strict';

const express = require('express');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { validateConfig } = require('./config');
const { AgentAwareError } = require('./errors');
const {
  assertNoSecretFields,
  createReceipt,
  createScopedContextAccessor,
  digestValue,
  validateScopedContextBundle,
} = require('./context-layer');

function createActionGateway(options) {
  const {
    config,
    authenticator,
    verifyBundle,
    receiptStore,
    handlers = {},
    now = () => new Date(),
    setTimer,
    clearTimer,
  } = options;

  validateConfig(config);
  const router = express.Router();
  const actionList = normalizeActions(config.actions);
  const actions = new Map(actionList.map((action) => [action.id, action]));
  const validators = compileActionValidators(actionList);
  const actionHandlers = { ...createBuiltInHandlers(config), ...handlers };

  router.get('/', (request, response) => {
    response.set('Cache-Control', discoveryCacheControl(config));
    response.json({
      schema_version: config.schema_version,
      type: 'action_catalog',
      authorization_notice: 'Discovery metadata describes capabilities; it does not authorize an action.',
      actions: actionList.map(publicAction),
    });
  });

  router.post('/:actionId', async (request, response, next) => {
    let contextAccessor = null;
    try {
      const action = actions.get(request.params.actionId);
      if (!action) {
        throw new AgentAwareError('ACTION_NOT_FOUND', 'The requested agent action is not available.', {
          status: 404,
        });
      }

      const body = request.body === undefined ? {} : request.body;
      if (
        !body
        || typeof body !== 'object'
        || Array.isArray(body)
      ) {
        throw new AgentAwareError(
          'ACTION_REQUEST_INVALID',
          'The action request must be a JSON object.',
          { status: 422 },
        );
      }
      const unsupportedFields = Object.keys(body)
        .filter((key) => !['input', 'context_bundle'].includes(key));
      if (unsupportedFields.length > 0) {
        throw new AgentAwareError(
          'ACTION_REQUEST_INVALID',
          'The action request contains unsupported fields.',
          { status: 422 },
        );
      }
      if (!action.context.required && Object.hasOwn(body, 'context_bundle')) {
        throw new AgentAwareError(
          'CONTEXT_BUNDLE_NOT_ALLOWED',
          'This context-free action does not accept a context bundle.',
          { status: 422 },
        );
      }
      const input = Object.hasOwn(body, 'input')
        ? body.input
        : {};
      const validateInput = validators.input.get(action.id);
      if (!validateInput(input)) {
        throw new AgentAwareError('ACTION_INPUT_INVALID', 'The action input does not match its contract.', {
          status: 422,
          details: safeValidationDetails(validateInput.errors),
        });
      }
      assertNoSecretFields(input, 'action input');

      let identity = {
        principal: 'untrusted_anonymous',
        authenticated_by: 'explicit_anonymous_class',
        client_instance: 'request:' + request.id,
      };
      if (action.auth === 'required') {
        if (typeof authenticator !== 'function') {
          throw new AgentAwareError(
            'AUTHENTICATION_UNAVAILABLE',
            'Protected agent actions are unavailable because authentication is not configured.',
            { status: 503, retryable: true },
          );
        }
        identity = await authenticator(request, action);
        assertAuthenticatedIdentity(identity);
      }

      const idempotencyKey = action.side_effect === 'none'
        ? null
        : requireIdempotencyKey(request.get('idempotency-key'));

      let bundle = null;
      let bundleValidation = null;
      let verification = null;
      let receiptRequired = false;
      let consumeReceipt = null;

      if (action.context.required) {
        const requestedVersion = request.get('context-layer-version');
        if (requestedVersion !== '0.1-draft') {
          throw new AgentAwareError(
            'CONTEXT_LAYER_VERSION_UNSUPPORTED',
            'This action requires Context-Layer-Version: 0.1-draft.',
            { status: 400 },
          );
        }
        if (!body.context_bundle) {
          throw new AgentAwareError(
            'CONTEXT_BUNDLE_REQUIRED',
            'This action requires an approved scoped context bundle.',
            { status: 403 },
          );
        }

        bundleValidation = validateScopedContextBundle(body.context_bundle, {
          expectedRecipient: config.agent.recipient,
          action,
          now: now(),
        });
        bundle = bundleValidation.bundle;

        if (typeof verifyBundle !== 'function') {
          throw new AgentAwareError(
            'BUNDLE_VERIFICATION_UNAVAILABLE',
            'Protected context cannot be used because bundle verification is not configured.',
            { status: 503, retryable: true },
          );
        }
        verification = await verifyBundle(bundle, {
          action,
          identity,
          requestId: request.id,
        });
        assertVerification(verification);

        if (
          (action.human_confirmation === 'required' || action.human_confirmation === true)
          && verification.approvalBound !== true
        ) {
          throw new AgentAwareError(
            'HUMAN_CONFIRMATION_REQUIRED',
            'This action requires approval bound to the exact context request.',
            { status: 403 },
          );
        }

        contextAccessor = createScopedContextAccessor(bundleValidation, {
          now,
          setTimer,
          clearTimer,
        });

        receiptRequired = Boolean(
          action.context.receipt_required || bundle.receipt_contract.required,
        );
        if (receiptRequired) {
          await assertReceiptStoreAvailable(receiptStore);
          if (idempotencyKey) {
            if (typeof receiptStore.reserveIdempotency !== 'function') {
              throw new AgentAwareError(
                'IDEMPOTENCY_STORE_UNAVAILABLE',
                'Side-effecting actions are unavailable because durable idempotency is not configured.',
                { status: 503, retryable: true },
              );
            }
            await receiptStore.reserveIdempotency(digestValue({
              action: action.id,
              principal: identity.principal,
              key: idempotencyKey,
            }));
          }
          consumeReceipt = createReceipt({
            operation: 'bundle.consume',
            bundle,
            actor: config.agent.id,
            issuer: config.context_layer.receipt_issuer,
            outcome: 'success',
            startedAt: now(),
            completedAt: now(),
            policySnapshotDigest: verification.policySnapshotDigest,
            input: {
              action: action.id,
              bundle_ref: bundle.id,
              idempotency_key: idempotencyKey,
            },
            output: { accepted: true },
            userSummary: 'Accepted an approved context bundle for ' + action.id + '; payload omitted.',
          });

          if (verification.singleUse === true) {
            await receiptStore.reserveBundle(bundle.id, consumeReceipt);
          } else {
            await receiptStore.append(consumeReceipt);
          }
        }
      }

      const handler = actionHandlers[action.id];
      if (typeof handler !== 'function') {
        throw new AgentAwareError(
          'ACTION_HANDLER_UNAVAILABLE',
          'The action is declared but no implementation is configured.',
          { status: 503, retryable: true },
        );
      }

      const startedAt = now();
      let result;
      try {
        const contextSnapshot = contextAccessor
          ? contextAccessor.getSnapshot()
          : null;
        result = await awaitHandlerWithinContext(handler({
          input,
          context: contextSnapshot ? contextSnapshot.context : [],
          contextAccessor,
          signal: contextAccessor ? contextAccessor.signal : null,
          bundle: bundle ? createHandlerBundle(bundle, action, contextSnapshot) : null,
          identity,
          requestId: request.id,
        }), contextAccessor);
        const validateOutput = validators.output.get(action.id);
        if (!validateOutput(result)) {
          throw new AgentAwareError(
            'ACTION_OUTPUT_INVALID',
            'The action result does not match its declared contract.',
            { status: 500, details: safeValidationDetails(validateOutput.errors) },
          );
        }
        assertNoSecretFields(result, 'action result');
        try {
          digestValue(result);
        } catch {
          throw new AgentAwareError(
            'ACTION_OUTPUT_INVALID',
            'The action result must be a finite, cycle-free JSON object.',
            { status: 500 },
          );
        }
        assertNoForbiddenContextEcho(result, bundle);
        if (contextAccessor) {
          contextAccessor.getSnapshot();
          contextAccessor.dispose();
          contextAccessor = null;
        }
      } catch (error) {
        if (receiptRequired) {
          const effectMayHaveOccurred = action.side_effect !== 'none';
          const failedReceipt = createReceipt({
            operation: action.id,
            bundle,
            actor: config.agent.id,
            issuer: config.context_layer.receipt_issuer,
            outcome: effectMayHaveOccurred ? 'indeterminate' : 'failure',
            startedAt,
            completedAt: now(),
            policySnapshotDigest: verification.policySnapshotDigest,
            input: { action: action.id, request_id: request.id },
            output: { completed: false, indeterminate: effectMayHaveOccurred },
            userSummary: effectMayHaveOccurred
              ? 'The ' + action.id + ' action outcome is indeterminate; payload omitted.'
              : 'The ' + action.id + ' action failed; payload omitted.',
          });
          try {
            await receiptStore.append(failedReceipt);
          } catch {
            throw new AgentAwareError(
              'RECEIPT_WRITE_FAILED_AFTER_ACTION',
              'The action outcome is indeterminate because its receipt could not be persisted.',
              { status: 503, retryable: true, indeterminate: action.side_effect !== 'none' },
            );
          }
        }
        if (action.side_effect !== 'none') {
          throw new AgentAwareError(
            'ACTION_OUTCOME_INDETERMINATE',
            'The side-effecting action outcome is indeterminate and must be reconciled before retry.',
            { status: 500, indeterminate: true },
          );
        }
        throw error;
      }

      let actionReceipt = null;
      if (receiptRequired) {
        actionReceipt = createReceipt({
          operation: action.id,
          bundle,
          actor: config.agent.id,
          issuer: config.context_layer.receipt_issuer,
          outcome: 'success',
          startedAt,
          completedAt: now(),
          policySnapshotDigest: verification.policySnapshotDigest,
          input: { action: action.id, request_id: request.id },
          output: result,
          userSummary: 'Completed ' + action.id + '; payload omitted.',
        });
        try {
          await receiptStore.append(actionReceipt);
        } catch {
          throw new AgentAwareError(
            'RECEIPT_WRITE_FAILED_AFTER_ACTION',
            'The action outcome is indeterminate because its completion receipt could not be persisted.',
            { status: 503, retryable: true, indeterminate: action.side_effect !== 'none' },
          );
        }
      }

      response.status(200).json({
        schema_version: config.schema_version,
        type: 'action_result',
        request_id: request.id,
        action: action.id,
        status: 'completed',
        result,
        receipts: [consumeReceipt, actionReceipt]
          .filter(Boolean)
          .map((receipt) => receipt.id),
      });
    } catch (error) {
      next(error);
    } finally {
      if (contextAccessor) contextAccessor.dispose();
    }
  });

  return router;
}

function awaitHandlerWithinContext(handlerResult, contextAccessor) {
  const operation = Promise.resolve(handlerResult);
  if (!contextAccessor) return operation;

  const { signal } = contextAccessor;
  if (signal.aborted) return Promise.reject(signal.reason);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, signal.reason);

    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

function compileActionValidators(actions) {
  const ajv = new Ajv({
    allErrors: true,
    strict: true,
    validateFormats: true,
  });
  addFormats(ajv);
  return {
    input: new Map(actions.map((action) => [
      action.id,
      ajv.compile(action.input_schema || { type: 'object', additionalProperties: false }),
    ])),
    output: new Map(actions.map((action) => [
      action.id,
      ajv.compile(action.output_schema || { type: 'object' }),
    ])),
  };
}

function safeValidationDetails(errors) {
  return (errors || []).slice(0, 8).map((entry) => ({
    path: entry.instancePath || '/',
    keyword: entry.keyword,
    message: entry.message,
  }));
}

function assertAuthenticatedIdentity(identity) {
  const stableIdentifier = (value) => (
    typeof value === 'string'
    && value.length >= 3
    && value.length <= 512
    && /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/.test(value)
  );
  const stableMethod = (value) => (
    typeof value === 'string'
    && value.length >= 1
    && value.length <= 128
    && /^[A-Za-z0-9._:/-]+$/.test(value)
  );

  if (
    !identity
    || typeof identity !== 'object'
    || Array.isArray(identity)
    || !stableIdentifier(identity.principal)
    || identity.principal === 'untrusted_anonymous'
    || !stableMethod(identity.authenticated_by)
    || identity.authenticated_by === 'explicit_anonymous_class'
    || !stableIdentifier(identity.client_instance)
  ) {
    throw new AgentAwareError(
      'AUTHENTICATION_INCOMPLETE',
      'The authenticator did not produce a stable non-anonymous caller binding.',
      { status: 503, retryable: true },
    );
  }
}

function requireIdempotencyKey(value) {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z0-9._~:+/-]{8,200}$/.test(value)
  ) {
    throw new AgentAwareError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'Side-effecting actions require an Idempotency-Key from 8 through 200 safe ASCII characters.',
      { status: 400 },
    );
  }
  return value;
}

function assertVerification(verification) {
  if (!verification || verification.verified !== true) {
    throw new AgentAwareError(
      'BUNDLE_VERIFICATION_FAILED',
      'The context bundle could not be authenticated.',
      { status: 403 },
    );
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(verification.policySnapshotDigest || '')) {
    throw new AgentAwareError(
      'BUNDLE_VERIFICATION_INCOMPLETE',
      'Bundle verification did not provide the policy snapshot evidence required for receipts.',
      { status: 503, retryable: true },
    );
  }
  if (verification.requesterBound !== true) {
    throw new AgentAwareError(
      'BUNDLE_VERIFICATION_INCOMPLETE',
      'Bundle verification did not bind the authenticated caller to the approved request.',
      { status: 503, retryable: true },
    );
  }
  if (typeof verification.singleUse !== 'boolean') {
    throw new AgentAwareError(
      'BUNDLE_VERIFICATION_INCOMPLETE',
      'Bundle verification did not report replay and single-use semantics.',
      { status: 503, retryable: true },
    );
  }
}

function createHandlerBundle(bundle, action, contextSnapshot) {
  return Object.freeze({
    id: bundle.id,
    request_ref: bundle.request_ref,
    decision_ref: bundle.decision_ref,
    recipient: bundle.recipient,
    purpose: contextSnapshot ? contextSnapshot.purpose : bundle.purpose,
    expires_at: contextSnapshot ? contextSnapshot.expires_at : bundle.expires_at,
    context: contextSnapshot ? contextSnapshot.context : Object.freeze([]),
    capabilities: Object.freeze([action.id]),
    restrictions: bundle.restrictions,
  });
}

function assertNoForbiddenContextEcho(result, bundle) {
  if (!bundle || bundle.restrictions.onward_disclosure !== 'forbidden') return;
  const protectedValues = [
    bundle.context.length,
    ...bundle.context.flatMap((claim) => [
      claim.claim,
      claim.predicate,
      claim.confidence,
      claim.provenance_handles.length,
      ...claim.provenance_handles,
      ...collectProtectedJsonValues(claim.value),
    ]),
  ];
  if (protectedValues.some((value) => containsJsonValue(result, value))) {
    throw new AgentAwareError(
      'ACTION_OUTPUT_RESTRICTED',
      'The action result would disclose context that is restricted from onward disclosure.',
      { status: 500 },
    );
  }
}

function collectProtectedJsonValues(value) {
  const values = [value];
  if (Array.isArray(value)) {
    for (const entry of value) values.push(...collectProtectedJsonValues(entry));
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      values.push(key);
      values.push(...collectProtectedJsonValues(nested));
    }
  }
  return values;
}

function containsJsonValue(candidate, protectedValue) {
  if (jsonEqual(candidate, protectedValue)) return true;
  if (
    typeof candidate === 'string'
    && typeof protectedValue === 'string'
    && protectedValue.length >= 3
    && candidate.includes(protectedValue)
  ) {
    return true;
  }
  if (Array.isArray(candidate)) {
    return candidate.some((entry) => containsJsonValue(entry, protectedValue));
  }
  if (candidate && typeof candidate === 'object') {
    return Object.entries(candidate).some(([key, entry]) => (
      containsJsonValue(key, protectedValue)
      || containsJsonValue(entry, protectedValue)
    ));
  }
  return false;
}

function jsonEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  try {
    return digestValue(left) === digestValue(right);
  } catch {
    return false;
  }
}

async function assertReceiptStoreAvailable(receiptStore) {
  if (!receiptStore || typeof receiptStore.preflight !== 'function') {
    throw new AgentAwareError(
      'RECEIPT_STORE_UNAVAILABLE',
      'The required receipt service is unavailable.',
      { status: 503, retryable: true },
    );
  }
  try {
    const available = await receiptStore.preflight();
    if (available !== true) throw new Error('receipt store preflight failed');
  } catch {
    throw new AgentAwareError(
      'RECEIPT_STORE_UNAVAILABLE',
      'The required receipt service is unavailable.',
      { status: 503, retryable: true },
    );
  }
}

function publicAction(action) {
  return {
    id: action.id,
    name: action.name || action.id,
    description: action.description,
    endpoint: '/api/v1/agent-actions/' + action.id,
    auth: action.auth,
    side_effect: action.side_effect,
    human_confirmation: action.human_confirmation || false,
    context: action.context,
    input_schema: action.input_schema || { type: 'object', additionalProperties: false },
    output_schema: action.output_schema || { type: 'object' },
  };
}

function createBuiltInHandlers(config) {
  return {
    'site.status': async () => ({
      status: 'ok',
      agent: config.agent.id,
      context_layer: {
        version: config.context_layer.version || config.context_layer.spec_version,
        integration_status: config.context_layer.status,
        conformance: config.context_layer.conformance,
      },
    }),
    'context.inspect': async ({ context }) => {
      // Access is request-local and revocable; no claim-derived metadata is returned.
      context.length;
      return {
        accepted: true,
        note: 'Approved context was inspected locally and omitted from the response.',
      };
    },
  };
}

function normalizeActions(actions) {
  return Array.isArray(actions) ? actions : Object.values(actions || {});
}

function discoveryCacheControl(config) {
  if (typeof config.discovery.cache_control === 'string') {
    return config.discovery.cache_control;
  }
  const seconds = Number.isInteger(config.discovery.cache_seconds)
    ? config.discovery.cache_seconds
    : 300;
  return 'public, max-age=' + seconds;
}

module.exports = {
  createActionGateway,
  normalizeActions,
  publicAction,
};
