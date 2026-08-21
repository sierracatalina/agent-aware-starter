'use strict';

const {
  cloneJson,
  contextError,
  isPlainObject,
  parseInstant,
} = require('./utils');

function createScopedContextAccessor(validation, options = {}) {
  assertValidatedBundle(validation);

  const deadlineMs = validation.effectiveExpiresAtMs;
  const deadline = new Date(deadlineMs).toISOString();
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const setTimer = typeof options.setTimer === 'function'
    ? options.setTimer
    : (callback, delay) => setTimeout(callback, delay);
  const clearTimer = typeof options.clearTimer === 'function'
    ? options.clearTimer
    : (handle) => clearTimeout(handle);

  let state = 'active';
  let timer = null;
  let membrane = null;
  let snapshotProxy = null;
  let snapshotTarget = buildSnapshot(validation, deadline);
  const abortController = new AbortController();

  validation = null;

  function currentTime() {
    const value = now();
    if (typeof value === 'number') {
      if (Number.isFinite(value)) return value;
      throw contextError(
        'INVALID_TIMESTAMP',
        'scoped context accessor clock must return a finite timestamp.',
        { status: 500 },
      );
    }
    return parseInstant(value, 'scoped context accessor clock');
  }

  function reasonFor(nextState) {
    if (nextState === 'expired') {
      return contextError(
        'BUNDLE_EXPIRED',
        'The scoped context bundle is no longer valid.',
        { status: 410 },
      );
    }
    return contextError(
      'CONTEXT_ACCESSOR_DISPOSED',
      'The scoped context accessor has been disposed.',
      { status: 410 },
    );
  }

  function close(nextState) {
    if (state !== 'active') return false;
    state = nextState;
    const timerToClear = timer;
    timer = null;
    if (membrane) {
      membrane.revokeAll();
      membrane = null;
    }
    snapshotProxy = null;
    snapshotTarget = null;
    abortController.abort(reasonFor(nextState));
    if (timerToClear !== null) {
      try {
        clearTimer(timerToClear);
      } catch {
        // Access is already revoked; timer cleanup failure cannot reopen it.
      }
    }
    return true;
  }

  function expire() {
    return close('expired');
  }

  function ensureActive() {
    if (state === 'active' && currentTime() >= deadlineMs) expire();
    if (state !== 'active') throw abortController.signal.reason || reasonFor(state);
  }

  membrane = createRevocableMembrane(snapshotTarget, ensureActive);
  snapshotProxy = membrane.proxy;
  snapshotTarget = null;

  const remaining = deadlineMs - currentTime();
  if (remaining <= 0) {
    expire();
    throw abortController.signal.reason;
  }

  try {
    const handle = setTimer(expire, remaining);
    if (state === 'active') {
      timer = handle;
      if (timer && typeof timer.unref === 'function') timer.unref();
    } else {
      clearTimer(handle);
    }
  } catch (error) {
    close('disposed');
    throw contextError(
      'CONTEXT_TIMER_UNAVAILABLE',
      'Scoped context expiry could not be scheduled safely.',
      {
        status: 503,
        retryable: true,
        details: error && error.code ? [error.code] : [],
      },
    );
  }

  function getSnapshot() {
    ensureActive();
    return snapshotProxy;
  }

  function dispose() {
    return close('disposed');
  }

  const accessor = {
    deadline,
    deadlineMs,
    signal: abortController.signal,
    getSnapshot,
    read: getSnapshot,
    dispose,
    get snapshot() {
      return getSnapshot();
    },
    get accessible() {
      if (state === 'active' && currentTime() >= deadlineMs) expire();
      return state === 'active';
    },
  };
  return Object.freeze(accessor);
}

function assertValidatedBundle(validation) {
  if (
    !isPlainObject(validation)
    || validation.valid !== true
    || !isPlainObject(validation.bundle)
    || !Array.isArray(validation.bundle.context)
    || !Number.isFinite(validation.effectiveExpiresAtMs)
    || typeof validation.actionId !== 'string'
  ) {
    throw contextError(
      'VALIDATED_BUNDLE_REQUIRED',
      'A validated scoped context bundle result is required.',
      { status: 500 },
    );
  }
  const declared = parseInstant(
    validation.effectiveExpiresAt,
    'validation.effectiveExpiresAt',
  );
  if (declared !== validation.effectiveExpiresAtMs) {
    throw contextError(
      'VALIDATED_BUNDLE_DEADLINE_MISMATCH',
      'The validated bundle effective expiry is inconsistent.',
      { status: 500 },
    );
  }
}

function buildSnapshot(validation, deadline) {
  const context = validation.bundle.context.map((claim) => ({
    claim: cloneJson(claim.claim, 'context claim'),
    predicate: claim.predicate,
    value: cloneJson(claim.value, 'context value'),
    confidence: claim.confidence,
    provenance_handle_count: claim.provenance_handles.length,
  }));
  return {
    action_id: validation.actionId,
    purpose: validation.bundle.purpose,
    expires_at: deadline,
    context,
  };
}

function createRevocableMembrane(root, ensureActive) {
  const cache = new WeakMap();
  const revokers = [];

  function wrap(value) {
    if (!value || typeof value !== 'object') return value;
    const existing = cache.get(value);
    if (existing) return existing;

    const revocable = Proxy.revocable(value, {
      get(target, property, receiver) {
        ensureActive();
        return wrap(Reflect.get(target, property, receiver));
      },
      has(target, property) {
        ensureActive();
        return Reflect.has(target, property);
      },
      ownKeys(target) {
        ensureActive();
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, property) {
        ensureActive();
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (!descriptor || !('value' in descriptor) || !descriptor.configurable) {
          return descriptor;
        }
        return {
          ...descriptor,
          value: wrap(descriptor.value),
          writable: false,
        };
      },
      getPrototypeOf(target) {
        ensureActive();
        return Reflect.getPrototypeOf(target);
      },
      isExtensible(target) {
        ensureActive();
        return Reflect.isExtensible(target);
      },
      set() {
        ensureActive();
        return false;
      },
      defineProperty() {
        ensureActive();
        return false;
      },
      deleteProperty() {
        ensureActive();
        return false;
      },
      preventExtensions() {
        ensureActive();
        return false;
      },
      setPrototypeOf() {
        ensureActive();
        return false;
      },
    });

    cache.set(value, revocable.proxy);
    revokers.push(revocable.revoke);
    return revocable.proxy;
  }

  return {
    proxy: wrap(root),
    revokeAll() {
      for (const revoke of revokers.splice(0)) revoke();
    },
  };
}

module.exports = { createScopedContextAccessor };
