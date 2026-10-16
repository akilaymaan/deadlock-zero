/**
 * Deterministic incident scenarios used by the simulator and the incident
 * forensics UI.
 *
 * The values in this module are deliberately data-only. A simulator can use
 * `simulation` to generate a repeatable workload and can use `contention` to
 * explain why the workload degrades. Keeping the contract here free of engine
 * imports also lets callers consume the presets from either the browser or a
 * Node.js runner.
 */

import type { LockEvent, ScenarioPreset } from '../shared/types';

export type { LockEvent, ScenarioPreset } from '../shared/types';

/** Every preset uses the same load so scenarios can be compared fairly. */
export const DEFAULT_WORKER_COUNT = 500 as const;

/** Stable identifiers for the built-in production incident scenarios. */
export type ScenarioId =
  | 'payment-abba-deadlock'
  | 'microservice-circular-rpc'
  | 'db-pool-starvation'
  | 'inventory-double-spend'
  | 'cascading-retry-storm'
  | 'payment-ledger-ab-ba-lock-deadlock'
  | 'microservice-circular-rpc-lockup'
  | 'database-connection-pool-starvation'
  | 'inventory-double-spend-vector-race';

/** A descriptive alias for consumers that prefer the longer name. */
export type IncidentScenarioId = ScenarioId;

/** High-level failure classes represented by the presets. */
export type IncidentCategory =
  | 'deadlock'
  | 'distributed-deadlock'
  | 'resource-starvation'
  | 'data-race'
  | 'retry-storm';

/** Resource kinds understood by generic contention visualizers. */
export type ResourceKind =
  | 'mutex'
  | 'rwlock'
  | 'rpc-channel'
  | 'connection-pool'
  | 'database-row'
  | 'cache-key'
  | 'ledger'
  | 'idempotency-key'
  | 'worker-slot'
  | 'queue'
  | 'retry-budget'
  | 'quota';

/** How the incident's hot resources interact under load. */
export type ContentionMode =
  | 'ordered-locks'
  | 'circular-rpc'
  | 'pool-exhaustion'
  | 'optimistic-race'
  | 'retry-amplification';

/** The deterministic deadlock behavior to model for a simulation phase. */
export type DeadlockBehavior =
  | 'none'
  | 'lock-order-cycle'
  | 'rpc-cycle'
  | 'resource-starvation';

/** The deterministic request-drop behavior to model for a simulation phase. */
export type DropBehavior =
  | 'none'
  | 'request-timeout'
  | 'queue-overflow'
  | 'circuit-breaker'
  | 'retry-budget-rejection';

/**
 * Latency and throughput objectives for one simulator phase.
 *
 * Latency values are milliseconds. `throughputRps` is successful requests per
 * second, rather than offered load, so it can be compared before and after a
 * patch.
 */
export interface PerformanceTargets {
  readonly throughputRps: number;
  readonly p50LatencyMs: number;
  readonly p95LatencyMs: number;
}

/**
 * Observable behavior for a deterministic simulation phase.
 *
 * Rates are normalized so a generic simulator does not need incident-specific
 * logic: `dropRate` and `timeoutRate` are fractions in the inclusive range
 * [0, 1], while event rates are events per minute. A phase that does not use a
 * particular failure mode records zero for that metric.
 */
export interface SimulationPhase extends PerformanceTargets {
  readonly deadlockRatePerMinute: number;
  readonly dropRate: number;
  readonly timeoutRate: number;
  readonly raceRatePerMinute: number;
  readonly retryAmplificationFactor: number;
  readonly deadlockBehavior: DeadlockBehavior;
  readonly dropBehavior: DropBehavior;
}

/**
 * Complete simulator inputs for one incident.
 *
 * `seed`, `durationSeconds`, and `workerCount` make a run reproducible. The
 * simulator can compare `healthy` with `beforePatch` and `afterPatch` without
 * needing to infer targets from the incident prose.
 */
export interface ScenarioSimulation {
  readonly seed: number;
  readonly durationSeconds: number;
  readonly workerCount: number;
  readonly healthy: PerformanceTargets;
  readonly beforePatch: SimulationPhase;
  readonly afterPatch: SimulationPhase;
}

/** One resource or capacity boundary that can become contended. */
export interface ContendedResource {
  readonly id: string;
  readonly kind: ResourceKind;
  readonly capacity: number;
  readonly pressure: 'low' | 'moderate' | 'high' | 'critical';
  readonly description: string;
}

/**
 * Lock/resource evidence used by the simulator and incident explanation.
 *
 * `resourceOrder` is the safe order intended after remediation. The entries in
 * `observedOrderings` are the order(s) seen in the failing implementation; for
 * a race or retry storm they describe competing paths rather than locks.
 */
export interface ContentionMetadata {
  readonly mode: ContentionMode;
  readonly resourceOrder: readonly string[];
  readonly observedOrderings: readonly (readonly string[])[];
  readonly resources: readonly ContendedResource[];
  readonly hotSpots: readonly string[];
  readonly invariant: string;
  readonly maxHoldTimeMs: number;
}

/**
 * Stable contract for a production incident preset.
 *
 * `rootCause`, `impact`, and `remediationIntent` are concise narrative fields
 * suitable for a card or report. `contention` and `simulation` contain the
 * structured evidence and deterministic parameters needed by a generic
 * simulator.
 */
export interface IncidentScenario extends ScenarioPreset {
  readonly id: ScenarioId;
  readonly legacyId?: ScenarioId;
  readonly title: string;
  readonly category: IncidentCategory;
  readonly severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  readonly description: string;
  readonly events: LockEvent[];
  readonly brokenCode: string;
  readonly patchedCode: string;
  readonly serviceArea: string;
  readonly summary: string;
  readonly rootCause: string;
  readonly impact: string;
  readonly remediationIntent: string;
  readonly simulation: ScenarioSimulation;
  readonly contention: ContentionMetadata;
  readonly tags: readonly string[];
}

export const INCIDENT_PRESETS: readonly IncidentScenario[] = [
  {
    id: 'payment-abba-deadlock',
    legacyId: 'payment-ledger-ab-ba-lock-deadlock',
    title: 'Payment Ledger AB-BA Lock Deadlock',
    category: 'deadlock',
    severity: 'CRITICAL',
    description:
      'Concurrent transfers between Account_A and Account_B acquire row locks in opposite orders in src/services/ledger.ts, causing a classic circular wait deadlock.',
    serviceArea: 'Payments / ledger write path',
    summary:
      'Transfer and reconciliation workers acquire the same account and ledger locks in opposite orders.',
    rootCause:
      'TransferWorker holds Account_A before requesting Account_B, while ReconciliationWorker holds Account_B before requesting Account_A; concurrent transfers therefore form an AB-BA wait cycle.',
    impact:
      'A hot set of merchant accounts stalls payment writes, pushes p99 latency above 4.8 seconds, and causes client-visible timeouts that are retried as duplicate payment attempts.',
    remediationIntent:
      'Enforce one global canonical lock order (sort lock IDs lexicographically before acquiring), never perform network I/O while holding row locks, and release locks in reverse order.',
    events: [
      {
        id: 'evt-pay-1',
        workerId: 'Worker_1',
        resourceId: 'Account_A',
        action: 'ACQUIRE',
        timestamp: 1001,
        vectorClock: { Worker_1: 1, Worker_2: 0 },
        file: 'src/services/ledger.ts',
        line: 41,
        codeSnippet: 'await tx.acquireRowLock(fromAccountId); // Worker_1 locks Account_A',
      },
      {
        id: 'evt-pay-2',
        workerId: 'Worker_2',
        resourceId: 'Account_B',
        action: 'ACQUIRE',
        timestamp: 1004,
        vectorClock: { Worker_1: 0, Worker_2: 1 },
        file: 'src/services/ledger.ts',
        line: 42,
        codeSnippet: 'await tx.acquireRowLock(fromAccountId); // Worker_2 locks Account_B',
      },
      {
        id: 'evt-pay-3',
        workerId: 'Worker_1',
        resourceId: 'Account_B',
        action: 'WAIT',
        timestamp: 1012,
        vectorClock: { Worker_1: 2, Worker_2: 0 },
        file: 'src/services/ledger.ts',
        line: 48,
        codeSnippet: 'await tx.acquireRowLock(toAccountId);   // Worker_1 blocked on Account_B',
      },
      {
        id: 'evt-pay-4',
        workerId: 'Worker_2',
        resourceId: 'Account_A',
        action: 'WAIT',
        timestamp: 1015,
        vectorClock: { Worker_1: 0, Worker_2: 2 },
        file: 'src/services/ledger.ts',
        line: 49,
        codeSnippet: 'await tx.acquireRowLock(toAccountId);   // Worker_2 blocked on Account_A',
      },
    ],
    brokenCode: [
      '// src/services/ledger.ts (BROKEN: request-dependent lock ordering)',
      'export async function transferFunds(tx: LedgerTx, fromAccountId: string, toAccountId: string, amountCents: number) {',
      '  await tx.acquireRowLock(fromAccountId); // Line 41: Worker_1 locks Account_A, Worker_2 locks Account_B',
      '  await tx.acquireRowLock(toAccountId);   // Line 48: AB-BA circular wait under concurrent inverse transfers',
      '  await tx.debit(fromAccountId, amountCents);',
      '  await tx.credit(toAccountId, amountCents);',
      '  await tx.releaseAll();',
      '}',
    ].join('\n'),
    patchedCode: [
      '// src/services/ledger.ts (PATCHED: DeadlockZero canonical total lock ordering)',
      'export async function transferFunds(tx: LedgerTx, fromAccountId: string, toAccountId: string, amountCents: number) {',
      '  const [firstLock, secondLock] = [fromAccountId, toAccountId].sort((a, b) => a.localeCompare(b));',
      '  await tx.acquireRowLock(firstLock);  // Always acquires Account_A before Account_B',
      '  await tx.acquireRowLock(secondLock); // Eliminates circular wait in Wait-For Graph',
      '  try {',
      '    await tx.debit(fromAccountId, amountCents);',
      '    await tx.credit(toAccountId, amountCents);',
      '  } finally {',
      '    await tx.releaseRowLock(secondLock);',
      '    await tx.releaseRowLock(firstLock);',
      '  }',
      '}',
    ].join('\n'),
    simulation: {
      seed: 4101,
      durationSeconds: 60,
      workerCount: DEFAULT_WORKER_COUNT,
      healthy: {
        throughputRps: 9200,
        p50LatencyMs: 31,
        p95LatencyMs: 88,
      },
      beforePatch: {
        throughputRps: 2850,
        p50LatencyMs: 265,
        p95LatencyMs: 5100,
        deadlockRatePerMinute: 15,
        dropRate: 0.23,
        timeoutRate: 0.18,
        raceRatePerMinute: 0,
        retryAmplificationFactor: 1.4,
        deadlockBehavior: 'lock-order-cycle',
        dropBehavior: 'request-timeout',
      },
      afterPatch: {
        throughputRps: 9200,
        p50LatencyMs: 34,
        p95LatencyMs: 96,
        deadlockRatePerMinute: 0,
        dropRate: 0.004,
        timeoutRate: 0.002,
        raceRatePerMinute: 0,
        retryAmplificationFactor: 1.02,
        deadlockBehavior: 'none',
        dropBehavior: 'none',
      },
    },
    contention: {
      mode: 'ordered-locks',
      resourceOrder: ['ledger-entry', 'account-balance'],
      observedOrderings: [
        ['account-balance', 'ledger-entry'],
        ['ledger-entry', 'account-balance'],
      ],
      resources: [
        {
          id: 'account-balance',
          kind: 'rwlock',
          capacity: 1,
          pressure: 'critical',
          description: 'Per-account balance and hold lock used by payment mutations.',
        },
        {
          id: 'ledger-entry',
          kind: 'ledger',
          capacity: 1,
          pressure: 'high',
          description: 'Per-entry append/settlement lock for the double-entry ledger.',
        },
        {
          id: 'payment-idempotency-key',
          kind: 'idempotency-key',
          capacity: 1,
          pressure: 'moderate',
          description: 'Request key used to collapse client retries into one payment.',
        },
      ],
      hotSpots: ['merchant:acme-eu', 'account:acct-8842', 'ledger:entry-7f31'],
      invariant:
        'A transaction must acquire ledger-entry before account-balance and must release both before any remote call.',
      maxHoldTimeMs: 40,
    },
    tags: ['payments', 'two-phase-locking', 'lock-ordering', 'idempotency'],
  },
  {
    id: 'microservice-circular-rpc',
    legacyId: 'microservice-circular-rpc-lockup',
    title: 'Microservice Circular RPC Lockup',
    category: 'distributed-deadlock',
    severity: 'CRITICAL',
    description:
      'OrderService -> InventoryService -> BillingService -> OrderService hold distributed mutexes across synchronous RPC calls in src/rpc/orderMesh.ts.',
    serviceArea: 'Checkout / pricing / inventory RPC mesh',
    summary:
      'Synchronous service-to-service calls retain local mutexes while making a circular checkout, pricing, and inventory RPC chain.',
    rootCause:
      'OrderService holds OrderMutex while calling InventoryService, InventoryService holds StockMutex while calling BillingService, and BillingService holds InvoiceMutex while calling OrderService for state confirmation.',
    impact:
      'A small fraction of promotion-heavy carts consumes all three services’ RPC and worker capacity, returning 503s to checkout and causing a broad availability drop.',
    remediationIntent:
      'Break the synchronous cycle with an asynchronous reservation workflow, release local mutexes before RPC boundaries, and enforce canonical lock hierarchy.',
    events: [
      {
        id: 'evt-rpc-1',
        workerId: 'OrderService',
        resourceId: 'OrderMutex',
        action: 'ACQUIRE',
        timestamp: 2001,
        vectorClock: { OrderService: 1, InventoryService: 0, BillingService: 0 },
        file: 'src/rpc/orderMesh.ts',
        line: 28,
        codeSnippet: 'await distLock.acquire("OrderMutex");',
      },
      {
        id: 'evt-rpc-2',
        workerId: 'InventoryService',
        resourceId: 'StockMutex',
        action: 'ACQUIRE',
        timestamp: 2005,
        vectorClock: { OrderService: 0, InventoryService: 1, BillingService: 0 },
        file: 'src/rpc/orderMesh.ts',
        line: 54,
        codeSnippet: 'await distLock.acquire("StockMutex");',
      },
      {
        id: 'evt-rpc-3',
        workerId: 'BillingService',
        resourceId: 'InvoiceMutex',
        action: 'ACQUIRE',
        timestamp: 2009,
        vectorClock: { OrderService: 0, InventoryService: 0, BillingService: 1 },
        file: 'src/rpc/orderMesh.ts',
        line: 81,
        codeSnippet: 'await distLock.acquire("InvoiceMutex");',
      },
      {
        id: 'evt-rpc-4',
        workerId: 'OrderService',
        resourceId: 'StockMutex',
        action: 'WAIT',
        timestamp: 2018,
        vectorClock: { OrderService: 2, InventoryService: 0, BillingService: 0 },
        file: 'src/rpc/orderMesh.ts',
        line: 34,
        codeSnippet: 'await rpc.inventory.reserveWithLock("StockMutex"); // blocked on InventoryService',
      },
      {
        id: 'evt-rpc-5',
        workerId: 'InventoryService',
        resourceId: 'InvoiceMutex',
        action: 'WAIT',
        timestamp: 2022,
        vectorClock: { OrderService: 0, InventoryService: 2, BillingService: 0 },
        file: 'src/rpc/orderMesh.ts',
        line: 61,
        codeSnippet: 'await rpc.billing.holdMarginWithLock("InvoiceMutex"); // blocked on BillingService',
      },
      {
        id: 'evt-rpc-6',
        workerId: 'BillingService',
        resourceId: 'OrderMutex',
        action: 'WAIT',
        timestamp: 2027,
        vectorClock: { OrderService: 0, InventoryService: 0, BillingService: 2 },
        file: 'src/rpc/orderMesh.ts',
        line: 88,
        codeSnippet: 'await rpc.orders.confirmOrderWithLock("OrderMutex"); // blocked on OrderService',
      },
    ],
    brokenCode: [
      '// src/rpc/orderMesh.ts (BROKEN: holding distributed mutexes across synchronous circular RPC)',
      'export async function checkoutOrderMesh(orderId: string, skuId: string) {',
      '  await distLock.acquire("OrderMutex");                // Line 28: held across downstream RPCs',
      '  await rpc.inventory.reserveWithLock("StockMutex");   // Line 34: waits on Inventory -> Billing -> Order',
      '  await distLock.release("OrderMutex");',
      '}',
    ].join('\n'),
    patchedCode: [
      '// src/rpc/orderMesh.ts (PATCHED: release local mutex before RPC & enforce DAG lock hierarchy)',
      'export async function checkoutOrderMesh(orderId: string, skuId: string) {',
      '  const reservationToken = await distLock.withScopedLock("OrderMutex", async () => {',
      '    return prepareOrderIntent(orderId, skuId);',
      '  }); // OrderMutex released before crossing RPC boundary',
      '  await rpc.inventory.reserveAsync(reservationToken, { timeoutMs: 250 });',
      '}',
    ].join('\n'),
    simulation: {
      seed: 4102,
      durationSeconds: 60,
      workerCount: DEFAULT_WORKER_COUNT,
      healthy: {
        throughputRps: 6400,
        p50LatencyMs: 46,
        p95LatencyMs: 132,
      },
      beforePatch: {
        throughputRps: 1380,
        p50LatencyMs: 790,
        p95LatencyMs: 6200,
        deadlockRatePerMinute: 12,
        dropRate: 0.31,
        timeoutRate: 0.27,
        raceRatePerMinute: 0,
        retryAmplificationFactor: 1.8,
        deadlockBehavior: 'rpc-cycle',
        dropBehavior: 'circuit-breaker',
      },
      afterPatch: {
        throughputRps: 6400,
        p50LatencyMs: 52,
        p95LatencyMs: 168,
        deadlockRatePerMinute: 0,
        dropRate: 0.006,
        timeoutRate: 0.004,
        raceRatePerMinute: 0,
        retryAmplificationFactor: 1.05,
        deadlockBehavior: 'none',
        dropBehavior: 'none',
      },
    },
    contention: {
      mode: 'circular-rpc',
      resourceOrder: ['checkout-order-mutex', 'pricing-promotion-mutex', 'inventory-reservation-mutex'],
      observedOrderings: [
        ['checkout-order-mutex', 'pricing-promotion-mutex', 'inventory-reservation-mutex'],
        ['inventory-reservation-mutex', 'checkout-order-mutex'],
        ['pricing-promotion-mutex', 'inventory-reservation-mutex'],
      ],
      resources: [
        {
          id: 'checkout-order-mutex',
          kind: 'mutex',
          capacity: 1,
          pressure: 'high',
          description: 'Checkout order aggregate mutex held during reservation confirmation.',
        },
        {
          id: 'pricing-promotion-mutex',
          kind: 'mutex',
          capacity: 1,
          pressure: 'high',
          description: 'Pricing promotion-cache mutex held while calculating cart discounts.',
        },
        {
          id: 'inventory-reservation-mutex',
          kind: 'mutex',
          capacity: 1,
          pressure: 'critical',
          description: 'Inventory reservation mutex guarding a SKU allocation.',
        },
        {
          id: 'reservation-rpc-channel',
          kind: 'rpc-channel',
          capacity: 64,
          pressure: 'high',
          description: 'Shared synchronous RPC channel used by the three services.',
        },
      ],
      hotSpots: ['sku:SKU-9041', 'promotion:BLACK-FRIDAY', 'region:eu-west-1'],
      invariant:
        'No local mutex may be held across an RPC boundary; downstream calls must form a directed acyclic dependency graph.',
      maxHoldTimeMs: 25,
    },
    tags: ['microservices', 'rpc', 'circular-wait', 'bulkhead'],
  },
  {
    id: 'db-pool-starvation',
    legacyId: 'database-connection-pool-starvation',
    title: 'Database Connection Pool Starvation',
    category: 'resource-starvation',
    severity: 'HIGH',
    description:
      'Workers acquire a DB transaction lock in src/db/poolManager.ts before awaiting an un-timed-out external webhook, starving >80% of the worker pool.',
    serviceArea: 'Order API / primary database',
    summary:
      'HTTP workers retain scarce database connections while awaiting a slow external webhook, exhausting the primary pool.',
    rootCause:
      'The request handler acquires pg_tx_pool before awaiting an un-timed-out external webhook and keeps it checked out until the webhook returns; >80% of workers block indefinitely in WAIT.',
    impact:
      'New order requests queue behind the exhausted pool, hit the request deadline, and are dropped even though the database itself has CPU and I/O headroom.',
    remediationIntent:
      'Keep the database critical section narrow, release connections before external webhook calls, and enforce a strict connection acquisition timeout.',
    events: [
      {
        id: 'evt-pool-1',
        workerId: 'Worker_1',
        resourceId: 'pg_tx_pool',
        action: 'ACQUIRE',
        timestamp: 3001,
        vectorClock: { Worker_1: 1 },
        file: 'src/db/poolManager.ts',
        line: 31,
        codeSnippet: 'const conn = await pool.acquire("pg_tx_pool"); // held during external webhook',
      },
      {
        id: 'evt-pool-2',
        workerId: 'Worker_2',
        resourceId: 'pg_tx_pool',
        action: 'WAIT',
        timestamp: 3010,
        vectorClock: { Worker_2: 1 },
        file: 'src/db/poolManager.ts',
        line: 37,
        codeSnippet: 'const conn = await pool.acquire("pg_tx_pool"); // Worker_2 starved waiting on pool',
      },
      {
        id: 'evt-pool-3',
        workerId: 'Worker_3',
        resourceId: 'pg_tx_pool',
        action: 'WAIT',
        timestamp: 3012,
        vectorClock: { Worker_3: 1 },
        file: 'src/db/poolManager.ts',
        line: 37,
        codeSnippet: 'const conn = await pool.acquire("pg_tx_pool"); // Worker_3 starved waiting on pool',
      },
      {
        id: 'evt-pool-4',
        workerId: 'Worker_4',
        resourceId: 'pg_tx_pool',
        action: 'WAIT',
        timestamp: 3015,
        vectorClock: { Worker_4: 1 },
        file: 'src/db/poolManager.ts',
        line: 37,
        codeSnippet: 'const conn = await pool.acquire("pg_tx_pool"); // Worker_4 starved waiting on pool',
      },
      {
        id: 'evt-pool-5',
        workerId: 'Worker_5',
        resourceId: 'pg_tx_pool',
        action: 'WAIT',
        timestamp: 3019,
        vectorClock: { Worker_5: 1 },
        file: 'src/db/poolManager.ts',
        line: 37,
        codeSnippet: 'const conn = await pool.acquire("pg_tx_pool"); // Worker_5 starved waiting on pool',
      },
      {
        id: 'evt-pool-6',
        workerId: 'Worker_6',
        resourceId: 'pg_tx_pool',
        action: 'WAIT',
        timestamp: 3024,
        vectorClock: { Worker_6: 1 },
        file: 'src/db/poolManager.ts',
        line: 37,
        codeSnippet: 'const conn = await pool.acquire("pg_tx_pool"); // Worker_6 starved waiting on pool',
      },
    ],
    brokenCode: [
      '// src/db/poolManager.ts (BROKEN: DB connection held across un-timed-out external webhook)',
      'export async function processOrderWithWebhook(order: OrderPayload) {',
      '  const conn = await pool.acquire("pg_tx_pool"); // Line 31: connection checked out early',
      '  await conn.query("INSERT INTO orders VALUES ($1)", [order.id]);',
      '  await fetch(order.webhookUrl);                 // Line 37: blocks pool when webhook stalls',
      '  await conn.release();',
      '}',
    ].join('\n'),
    patchedCode: [
      '// src/db/poolManager.ts (PATCHED: release DB connection before external I/O + bounded timeout)',
      'export async function processOrderWithWebhook(order: OrderPayload) {',
      '  const conn = await pool.acquire("pg_tx_pool", { acquireTimeoutMs: 150 });',
      '  try {',
      '    await conn.query("INSERT INTO orders VALUES ($1)", [order.id]);',
      '  } finally {',
      '    await conn.release(); // Connection returned to pool before external network call',
      '  }',
      '  await fetchWithTimeout(order.webhookUrl, { timeoutMs: 1500 });',
      '}',
    ].join('\n'),
    simulation: {
      seed: 4103,
      durationSeconds: 60,
      workerCount: DEFAULT_WORKER_COUNT,
      healthy: {
        throughputRps: 3500,
        p50LatencyMs: 42,
        p95LatencyMs: 118,
      },
      beforePatch: {
        throughputRps: 470,
        p50LatencyMs: 720,
        p95LatencyMs: 11900,
        deadlockRatePerMinute: 0,
        dropRate: 0.38,
        timeoutRate: 0.34,
        raceRatePerMinute: 0,
        retryAmplificationFactor: 1.3,
        deadlockBehavior: 'none',
        dropBehavior: 'queue-overflow',
      },
      afterPatch: {
        throughputRps: 3500,
        p50LatencyMs: 45,
        p95LatencyMs: 145,
        deadlockRatePerMinute: 0,
        dropRate: 0.003,
        timeoutRate: 0.002,
        raceRatePerMinute: 0,
        retryAmplificationFactor: 1.01,
        deadlockBehavior: 'none',
        dropBehavior: 'none',
      },
    },
    contention: {
      mode: 'pool-exhaustion',
      resourceOrder: ['primary-db-pool'],
      observedOrderings: [
        ['http-worker', 'primary-db-pool', 'audit-rpc-channel'],
        ['http-worker', 'primary-db-pool', 'fraud-rpc-channel'],
      ],
      resources: [
        {
          id: 'primary-db-pool',
          kind: 'connection-pool',
          capacity: 80,
          pressure: 'critical',
          description: 'PostgreSQL primary pool shared by order and payment writes.',
        },
        {
          id: 'http-worker',
          kind: 'worker-slot',
          capacity: DEFAULT_WORKER_COUNT,
          pressure: 'high',
          description: 'Request worker retained while waiting for a connection or audit response.',
        },
        {
          id: 'audit-rpc-channel',
          kind: 'rpc-channel',
          capacity: 32,
          pressure: 'moderate',
          description: 'Slow audit dependency that lengthens the connection hold window.',
        },
      ],
      hotSpots: ['pool:orders-primary', 'tenant:marketplace', 'audit:fraud-event'],
      invariant:
        'A database connection is held only for the SQL critical section and is never held across audit or fraud RPC.',
      maxHoldTimeMs: 80,
    },
    tags: ['database', 'connection-pool', 'starvation', 'backpressure'],
  },
  {
    id: 'inventory-double-spend',
    legacyId: 'inventory-double-spend-vector-race',
    title: 'Inventory Flash-Sale Vector Race',
    category: 'data-race',
    severity: 'HIGH',
    description:
      'Concurrent READ then WRITE on sku_99_stock in src/checkout/stockEngine.ts with concurrent vector clocks {w1: 2, w2: 1} vs {w1: 1, w2: 2}, causing a flash-sale double-spend race.',
    serviceArea: 'Inventory reservation / fulfillment',
    summary:
      'Reservation workers concurrently read and overwrite sku_99_stock without a common lock or happens-before edge.',
    rootCause:
      'Worker w1 and Worker w2 both read sku_99_stock and write decremented stock counts with concurrent Lamport vector clocks ({w1: 2, w2: 1} || {w1: 1, w2: 2}); neither clock dominates the other, causing lost updates.',
    impact:
      'Hot flash-sale SKUs report more units reserved than exist in physical inventory, producing oversells and fulfillment reversals.',
    remediationIntent:
      'Serialize stock decrements with a per-SKU mutex or atomic compare-and-swap (CAS) predicate verifying the expected version clock.',
    events: [
      {
        id: 'evt-race-1',
        workerId: 'w1',
        resourceId: 'sku_99_stock',
        action: 'READ',
        timestamp: 4001,
        vectorClock: { w1: 1, w2: 1 },
        file: 'src/checkout/stockEngine.ts',
        line: 24,
        codeSnippet: 'const current = await stockStore.read("sku_99_stock"); // w1 reads stock=1',
      },
      {
        id: 'evt-race-2',
        workerId: 'w2',
        resourceId: 'sku_99_stock',
        action: 'READ',
        timestamp: 4002,
        vectorClock: { w1: 1, w2: 1 },
        file: 'src/checkout/stockEngine.ts',
        line: 24,
        codeSnippet: 'const current = await stockStore.read("sku_99_stock"); // w2 reads stock=1',
      },
      {
        id: 'evt-race-3',
        workerId: 'w1',
        resourceId: 'sku_99_stock',
        action: 'WRITE',
        timestamp: 4008,
        vectorClock: { w1: 2, w2: 1 },
        file: 'src/checkout/stockEngine.ts',
        line: 31,
        codeSnippet: 'await stockStore.write("sku_99_stock", current - 1); // w1 writes with clock {w1:2, w2:1}',
      },
      {
        id: 'evt-race-4',
        workerId: 'w2',
        resourceId: 'sku_99_stock',
        action: 'WRITE',
        timestamp: 4009,
        vectorClock: { w1: 1, w2: 2 },
        file: 'src/checkout/stockEngine.ts',
        line: 31,
        codeSnippet: 'await stockStore.write("sku_99_stock", current - 1); // w2 writes with clock {w1:1, w2:2}',
      },
    ],
    brokenCode: [
      '// src/checkout/stockEngine.ts (BROKEN: unsynchronized read-modify-write on sku_99_stock)',
      'export async function reserveFlashSaleItem(skuId: string, qty: number) {',
      '  const current = await stockStore.read(skuId);          // Line 24: concurrent unsynchronized READ',
      '  if (current < qty) throw new Error("Out of stock");',
      '  await stockStore.write(skuId, current - qty);          // Line 31: concurrent WRITE ({w1:2,w2:1} || {w1:1,w2:2})',
      '}',
    ].join('\n'),
    patchedCode: [
      '// src/checkout/stockEngine.ts (PATCHED: per-SKU mutex + atomic compare-and-swap version check)',
      'export async function reserveFlashSaleItem(skuId: string, qty: number) {',
      '  return skuLockManager.withLock(`lock:${skuId}`, async () => {',
      '    const { value, version } = await stockStore.readVersioned(skuId);',
      '    if (value < qty) throw new Error("Out of stock");',
      '    await stockStore.compareAndSwap(skuId, value - qty, version); // Enforces total causal order',
      '  });',
      '}',
    ].join('\n'),
    simulation: {
      seed: 4104,
      durationSeconds: 60,
      workerCount: DEFAULT_WORKER_COUNT,
      healthy: {
        throughputRps: 5100,
        p50LatencyMs: 38,
        p95LatencyMs: 108,
      },
      beforePatch: {
        throughputRps: 5010,
        p50LatencyMs: 61,
        p95LatencyMs: 510,
        deadlockRatePerMinute: 0,
        dropRate: 0.008,
        timeoutRate: 0.002,
        raceRatePerMinute: 43,
        retryAmplificationFactor: 1.02,
        deadlockBehavior: 'none',
        dropBehavior: 'none',
      },
      afterPatch: {
        throughputRps: 5100,
        p50LatencyMs: 42,
        p95LatencyMs: 121,
        deadlockRatePerMinute: 0,
        dropRate: 0.004,
        timeoutRate: 0.001,
        raceRatePerMinute: 0,
        retryAmplificationFactor: 1.01,
        deadlockBehavior: 'none',
        dropBehavior: 'none',
      },
    },
    contention: {
      mode: 'optimistic-race',
      resourceOrder: ['inventory-row', 'reservation-ledger'],
      observedOrderings: [
        ['inventory-row'],
        ['reservation-ledger', 'inventory-row'],
      ],
      resources: [
        {
          id: 'inventory-row',
          kind: 'database-row',
          capacity: 1,
          pressure: 'critical',
          description: 'Available quantity for a single hot SKU and fulfillment location.',
        },
        {
          id: 'inventory-cache-key',
          kind: 'cache-key',
          capacity: 1,
          pressure: 'high',
          description: 'Cached quantity read by reservation workers before persistence.',
        },
        {
          id: 'reservation-ledger',
          kind: 'ledger',
          capacity: 1,
          pressure: 'moderate',
          description: 'Append-only reservation event stream used by cancellation workers.',
        },
      ],
      hotSpots: ['sku:SKU-4471', 'warehouse:dfw-02', 'reservation:resv-6a91'],
      invariant:
        'Every quantity transition must observe the latest row version and commit atomically with its reservation event.',
      maxHoldTimeMs: 15,
    },
    tags: ['inventory', 'data-race', 'vector-clock', 'compare-and-swap'],
  },
  {
    id: 'cascading-retry-storm',
    legacyId: 'cascading-retry-storm',
    title: 'Distributed Lock Retry Storm',
    category: 'retry-storm',
    severity: 'HIGH',
    description:
      'Synchronized thundering-herd retries without exponential backoff or jitter in src/queue/retryWorker.ts contend on shard locks and retry budgets.',
    serviceArea: 'API gateway / catalog dependency mesh',
    summary:
      'Retries without a shared budget or jitter multiply load after a dependency begins returning transient 503s.',
    rootCause:
      'RetryWorker_1 and RetryWorker_2 re-acquire shard_lock and retry_quota_lock in conflicting orders during synchronized zero-jitter retries, triggering both lock cycles and queue saturation.',
    impact:
      'A transient brownout becomes a fleet-wide saturation event: healthy requests are evicted from queues and p99 latency spikes above 4.9 seconds.',
    remediationIntent:
      'Propagate a single retry budget per request, acquire shard and quota locks in canonical order, and apply exponential backoff with full jitter.',
    events: [
      {
        id: 'evt-retry-1',
        workerId: 'RetryWorker_1',
        resourceId: 'shard_lock_0',
        action: 'ACQUIRE',
        timestamp: 5001,
        vectorClock: { RetryWorker_1: 1, RetryWorker_2: 0 },
        file: 'src/queue/retryWorker.ts',
        line: 22,
        codeSnippet: 'await lockManager.acquire("shard_lock_0"); // RetryWorker_1 holds shard_lock_0',
      },
      {
        id: 'evt-retry-2',
        workerId: 'RetryWorker_2',
        resourceId: 'retry_quota_lock',
        action: 'ACQUIRE',
        timestamp: 5003,
        vectorClock: { RetryWorker_1: 0, RetryWorker_2: 1 },
        file: 'src/queue/retryWorker.ts',
        line: 29,
        codeSnippet: 'await lockManager.acquire("retry_quota_lock"); // RetryWorker_2 holds retry_quota_lock',
      },
      {
        id: 'evt-retry-3',
        workerId: 'RetryWorker_1',
        resourceId: 'retry_quota_lock',
        action: 'WAIT',
        timestamp: 5008,
        vectorClock: { RetryWorker_1: 2, RetryWorker_2: 0 },
        file: 'src/queue/retryWorker.ts',
        line: 36,
        codeSnippet: 'await lockManager.acquire("retry_quota_lock"); // blocked on RetryWorker_2',
      },
      {
        id: 'evt-retry-4',
        workerId: 'RetryWorker_2',
        resourceId: 'shard_lock_0',
        action: 'WAIT',
        timestamp: 5010,
        vectorClock: { RetryWorker_1: 0, RetryWorker_2: 2 },
        file: 'src/queue/retryWorker.ts',
        line: 43,
        codeSnippet: 'await lockManager.acquire("shard_lock_0"); // blocked on RetryWorker_1',
      },
    ],
    brokenCode: [
      '// src/queue/retryWorker.ts (BROKEN: zero-jitter retry loop with inverted lock acquisition)',
      'export async function executeWithRetry(job: QueueJob) {',
      '  while (true) {',
      '    await lockManager.acquire(job.primaryLock);   // Line 22: unsorted lock acquisition',
      '    await lockManager.acquire(job.secondaryLock); // Line 36: deadlocks under thundering-herd retry',
      '    if (await tryDispatch(job)) break;',
      '  }',
      '}',
    ].join('\n'),
    patchedCode: [
      '// src/queue/retryWorker.ts (PATCHED: canonical lock order + bounded retry budget with full jitter)',
      'export async function executeWithRetry(job: QueueJob) {',
      '  const orderedLocks = [job.primaryLock, job.secondaryLock].sort();',
      '  for (let attempt = 0; attempt < 3; attempt++) {',
      '    if (await lockManager.withCanonicalLocks(orderedLocks, () => tryDispatch(job))) return;',
      '    const jitterMs = Math.random() * Math.min(1000, 50 * Math.pow(2, attempt));',
      '    await sleep(jitterMs); // Release all locks before sleeping on backoff',
      '  }',
      '}',
    ].join('\n'),
    simulation: {
      seed: 4105,
      durationSeconds: 60,
      workerCount: DEFAULT_WORKER_COUNT,
      healthy: {
        throughputRps: 12000,
        p50LatencyMs: 25,
        p95LatencyMs: 78,
      },
      beforePatch: {
        throughputRps: 2600,
        p50LatencyMs: 960,
        p95LatencyMs: 9100,
        deadlockRatePerMinute: 0,
        dropRate: 0.46,
        timeoutRate: 0.41,
        raceRatePerMinute: 0,
        retryAmplificationFactor: 7.2,
        deadlockBehavior: 'none',
        dropBehavior: 'queue-overflow',
      },
      afterPatch: {
        throughputRps: 12000,
        p50LatencyMs: 31,
        p95LatencyMs: 105,
        deadlockRatePerMinute: 0,
        dropRate: 0.009,
        timeoutRate: 0.006,
        raceRatePerMinute: 0,
        retryAmplificationFactor: 1.1,
        deadlockBehavior: 'none',
        dropBehavior: 'retry-budget-rejection',
      },
    },
    contention: {
      mode: 'retry-amplification',
      resourceOrder: ['request-retry-budget', 'catalog-quota', 'gateway-queue'],
      observedOrderings: [
        ['gateway-queue', 'catalog-quota', 'request-retry-budget'],
        ['recommendation-queue', 'catalog-quota'],
        ['catalog-quota', 'gateway-queue'],
      ],
      resources: [
        {
          id: 'request-retry-budget',
          kind: 'retry-budget',
          capacity: 2,
          pressure: 'critical',
          description: 'Maximum extra attempts permitted for one inbound request.',
        },
        {
          id: 'catalog-quota',
          kind: 'quota',
          capacity: 900,
          pressure: 'critical',
          description: 'Catalog service request quota shared by all callers.',
        },
        {
          id: 'gateway-queue',
          kind: 'queue',
          capacity: 2000,
          pressure: 'high',
          description: 'Ingress queue that overflows when synchronized retries return together.',
        },
      ],
      hotSpots: ['dependency:catalog', 'route:/search', 'zone:us-east-1a'],
      invariant:
        'One request owns one propagated retry budget and deadline; retries must be jittered, idempotent, and admitted only while downstream quota remains.',
      maxHoldTimeMs: 0,
    },
    tags: ['retries', 'backpressure', 'circuit-breaker', 'load-shedding'],
  },
] satisfies readonly IncidentScenario[];

/** Alias retained for callers that use the shorter scenario-oriented name. */
export const SCENARIO_PRESETS = INCIDENT_PRESETS;
export const PRESETS = INCIDENT_PRESETS;

/** Lower-camel-case alias for JavaScript consumers. */
export const scenarioPresets = INCIDENT_PRESETS;

const LEGACY_ID_ALIASES: Readonly<Record<string, string>> = {
  'payment-ledger-ab-ba-lock-deadlock': 'payment-abba-deadlock',
  'microservice-circular-rpc-lockup': 'microservice-circular-rpc',
  'database-connection-pool-starvation': 'db-pool-starvation',
  'inventory-double-spend-vector-race': 'inventory-double-spend',
};

/**
 * Return a preset by stable id (supports both primary and legacy scenario IDs).
 */
export function getScenarioPreset(id: ScenarioId): IncidentScenario;
export function getScenarioPreset(id: string): IncidentScenario | undefined;
export function getScenarioPreset(id: string): IncidentScenario | undefined {
  const normalizedId = LEGACY_ID_ALIASES[id] ?? id;
  return INCIDENT_PRESETS.find(
    (scenario) => scenario.id === normalizedId || scenario.legacyId === id,
  );
}
