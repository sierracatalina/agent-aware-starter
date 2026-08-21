'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createScopedContextAccessor,
  validateScopedContextBundle,
} = require('../src/context-layer');
const validBundle = require('./fixtures/context-layer/valid-bundle.json');

const START = '2026-08-20T12:30:00.000Z';
const DEADLINE = '2026-08-20T13:00:00.000Z';
const ACTION = Object.freeze({
  id: 'context.inspect',
  context: Object.freeze({
    required: true,
    purposes: Object.freeze(['inspect approved project context']),
    purpose_match: 'exact',
    selectors: Object.freeze(['project_status']),
    max_retention_seconds: 3600,
    receipt_required: true,
  }),
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function errorCode(code) {
  return (error) => {
    assert.equal(error.code, code);
    return true;
  };
}

function validateAt(bundle = validBundle, now = START) {
  return validateScopedContextBundle(bundle, {
    expectedRecipient: 'urn:aaa:agent:starter',
    action: ACTION,
    now: new Date(now),
  });
}

function createClock(start = START) {
  let current = Date.parse(start);
  let nextHandle = 1;
  let clearedTimers = 0;
  const timers = new Map();

  function setTimer(callback, delay) {
    const handle = nextHandle;
    nextHandle += 1;
    timers.set(handle, { callback, deadline: current + delay });
    return handle;
  }

  function clearTimer(handle) {
    if (timers.delete(handle)) clearedTimers += 1;
  }

  function runDueTimers() {
    while (true) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.deadline <= current)
        .sort((left, right) => left[1].deadline - right[1].deadline);
      if (due.length === 0) return;
      for (const [handle, timer] of due) {
        if (!timers.delete(handle)) continue;
        timer.callback();
      }
    }
  }

  return {
    now: () => current,
    setTimer,
    clearTimer,
    advanceTo(instant, { runTimers = true } = {}) {
      current = Date.parse(instant);
      if (runTimers) runDueTimers();
    },
    get pendingTimers() {
      return timers.size;
    },
    get clearedTimers() {
      return clearedTimers;
    },
  };
}

function accessorAt(clock, bundle = validBundle) {
  return createScopedContextAccessor(validateAt(bundle), {
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
}

test('derives the deadline and exposes only a deeply read-only minimized snapshot', () => {
  const clock = createClock();
  const bundle = clone(validBundle);
  bundle.context[0].value = {
    status: 'on_track',
    milestones: ['alpha'],
  };
  const accessor = accessorAt(clock, bundle);
  const snapshot = accessor.getSnapshot();

  assert.equal(accessor.deadline, DEADLINE);
  assert.equal(accessor.deadlineMs, Date.parse(DEADLINE));
  assert.equal(accessor.accessible, true);
  assert.equal(accessor.signal.aborted, false);
  assert.equal(Object.isFrozen(accessor), true);
  assert.equal(accessor.snapshot, snapshot);
  assert.equal(accessor.read(), snapshot);

  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), {
    action_id: 'context.inspect',
    purpose: 'inspect approved project context',
    expires_at: DEADLINE,
    context: [{
      claim: 'The project is on track.',
      predicate: 'project_status',
      value: {
        status: 'on_track',
        milestones: ['alpha'],
      },
      confidence: 0.96,
      provenance_handle_count: 1,
    }],
  });

  assert.equal('issuer' in snapshot, false);
  assert.equal('provenance' in snapshot, false);
  assert.equal('provenance_handles' in snapshot.context[0], false);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes('urn:cl:bundle-issuer'), false);
  assert.equal(serialized.includes('urn:cl:provenance'), false);

  assert.throws(() => {
    snapshot.purpose = 'changed';
  }, TypeError);
  assert.throws(() => {
    snapshot.context[0].value.status = 'changed';
  }, TypeError);
  assert.throws(() => {
    snapshot.context[0].value.milestones.push('beta');
  }, TypeError);

  const descriptor = Object.getOwnPropertyDescriptor(snapshot, 'context');
  assert.equal(descriptor.writable, false);
  assert.throws(() => descriptor.value.pop(), TypeError);
  assert.equal(snapshot.context.length, 1);

  accessor.dispose();
});

test('timer expiry aborts and revokes root and already-retained nested snapshots', () => {
  const clock = createClock();
  const accessor = accessorAt(clock);
  const snapshot = accessor.snapshot;
  const retainedClaim = snapshot.context[0];

  clock.advanceTo(DEADLINE);

  assert.equal(accessor.accessible, false);
  assert.equal(accessor.signal.aborted, true);
  assert.equal(accessor.signal.reason.code, 'BUNDLE_EXPIRED');
  assert.equal(clock.pendingTimers, 0);
  assert.throws(() => accessor.getSnapshot(), errorCode('BUNDLE_EXPIRED'));
  assert.throws(() => snapshot.purpose, TypeError);
  assert.throws(() => retainedClaim.value, TypeError);
});

test('clock check closes access even when the injected timer callback is delayed', () => {
  const clock = createClock();
  const accessor = accessorAt(clock);

  clock.advanceTo(DEADLINE, { runTimers: false });
  assert.equal(accessor.signal.aborted, false);
  assert.throws(() => accessor.read(), errorCode('BUNDLE_EXPIRED'));

  assert.equal(accessor.signal.aborted, true);
  assert.equal(accessor.signal.reason.code, 'BUNDLE_EXPIRED');
  assert.equal(accessor.accessible, false);
  assert.equal(clock.pendingTimers, 0);
});

test('explicit dispose clears the timer, aborts, and revokes retained references', () => {
  const clock = createClock();
  const accessor = accessorAt(clock);
  const snapshot = accessor.snapshot;
  const retainedContext = snapshot.context;

  assert.equal(clock.pendingTimers, 1);
  assert.equal(accessor.dispose(), true);

  assert.equal(clock.pendingTimers, 0);
  assert.equal(clock.clearedTimers, 1);
  assert.equal(accessor.accessible, false);
  assert.equal(accessor.signal.aborted, true);
  assert.equal(accessor.signal.reason.code, 'CONTEXT_ACCESSOR_DISPOSED');
  assert.equal(accessor.dispose(), false);
  assert.throws(
    () => accessor.snapshot,
    errorCode('CONTEXT_ACCESSOR_DISPOSED'),
  );
  assert.throws(() => retainedContext.length, TypeError);
});

test('creation fails closed if the validated deadline has elapsed before wrapping', () => {
  const validation = validateAt();
  let scheduled = 0;

  assert.throws(
    () => createScopedContextAccessor(validation, {
      now: () => Date.parse(DEADLINE),
      setTimer() {
        scheduled += 1;
      },
      clearTimer() {},
    }),
    errorCode('BUNDLE_EXPIRED'),
  );
  assert.equal(scheduled, 0);
});

test('requires the validator result and rejects inconsistent effective deadlines', () => {
  const clock = createClock();
  assert.throws(
    () => createScopedContextAccessor(validBundle, {
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    }),
    errorCode('VALIDATED_BUNDLE_REQUIRED'),
  );

  const validation = {
    ...validateAt(),
    effectiveExpiresAt: '2026-08-20T13:01:00.000Z',
  };
  assert.throws(
    () => createScopedContextAccessor(validation, {
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    }),
    errorCode('VALIDATED_BUNDLE_DEADLINE_MISMATCH'),
  );
});
