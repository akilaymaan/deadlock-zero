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

/** Every preset uses the same load so scenarios can be compared fairly. */
export const DEFAULT_WORKER_COUNT = 500 as const;

/** Stable identifiers for the built-in production incident scenarios. */
export type ScenarioId =
  | 'payment-ledger-ab-ba-lock-deadlock'
  | 'microservice-circular-rpc-lockup'
  | 'database-connection-pool-starvation'
  | 'inventory-double-spend-vector-race'
  | 'cascading-retry-storm';

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
export interface IncidentScenario {
  readonly id: ScenarioId;
  readonly title: string;
  readonly category: IncidentCategory;
  readonly serviceArea: string;
  readonly summary: string;
  readonly rootCause: string;
  readonly impact: string;
  readonly remediationIntent: string;
  readonly simulation: ScenarioSimulation;
  readonly contention: ContentionMetadata;
  readonly tags: readonly string[];
}

/**
 * Five realistic incidents with fixed seeds and explicit healthy, failing, and
 * remediated behavior. `as const` preserves literal ids/titles and makes the
 * exported collection deeply readonly at the TypeScript boundary.
 */
export const INCIDENT_PRESETS = [
  {
    id: 'payment-ledger-ab-ba-lock-deadlock',
    title: 'Payment Ledger AB-BA Lock Deadlock',
    category: 'deadlock',
    serviceArea: 'Payments / ledger write path',
    summary:
      'Transfer and reconciliation workers acquire the same account and ledger locks in opposite orders.',
    rootCause:
      'TransferWorker holds account:{accountId} before requesting ledger:{entryId}, while ReconciliationWorker holds ledger:{entryId} before requesting account:{accountId}; a concurrent transfer and reconciliation therefore form an AB-BA wait cycle.',
    impact:
      'A hot set of merchant accounts stalls payment writes, pushes p95 latency above five seconds, and causes client-visible timeouts that are retried as duplicate payment attempts.',
    remediationIntent:
      'Enforce one global lock order (ledger entry before account balance), never perform network I/O while holding either lock, and fail a lock wait with bounded jittered retry rather than parking a worker indefinitely.',
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
    id: 'microservice-circular-rpc-lockup',
    title: 'Microservice Circular RPC Lockup',
    category: 'distributed-deadlock',
    serviceArea: 'Checkout / pricing / inventory RPC mesh',
    summary:
      'Synchronous service-to-service calls retain local mutexes while making a circular checkout, pricing, and inventory RPC chain.',
    rootCause:
      'Checkout holds its order mutex while calling Pricing, Pricing holds a promotion mutex while calling Inventory, and Inventory calls Checkout for reservation confirmation; the cycle is amplified by synchronous RPC deadlines and shared worker pools.',
    impact:
      'A small fraction of promotion-heavy carts consumes all three services’ RPC and worker capacity, returning 503s to checkout and causing a broad but uneven availability drop across regions.',
    remediationIntent:
      'Break the synchronous cycle with an asynchronous reservation workflow, release local mutexes before RPC, propagate a single deadline, and apply bounded bulkheads per downstream dependency.',
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
    id: 'database-connection-pool-starvation',
    title: 'Database Connection Pool Starvation',
    category: 'resource-starvation',
    serviceArea: 'Order API / primary database',
    summary:
      'HTTP workers retain scarce database connections while awaiting a slow audit service, exhausting the primary pool.',
    rootCause:
      'The request handler checks out a primary connection before starting an independent audit RPC and keeps it checked out until the RPC returns; a p99 audit latency spike pins all 80 connections while hundreds of workers queue.',
    impact:
      'New order requests queue behind the exhausted pool, hit the 12-second request deadline, and are dropped even though the database itself has CPU and I/O headroom.',
    remediationIntent:
      'Keep the database critical section narrow, release connections before external calls, isolate audit writes in an independent bounded queue, and expose pool wait time as a saturation signal.',
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
    id: 'inventory-double-spend-vector-race',
    title: 'Inventory Double-Spend Vector Race',
    category: 'data-race',
    serviceArea: 'Inventory reservation / fulfillment',
    summary:
      'Reservation and cancellation workers concurrently update the same SKU quantity without a common synchronization edge.',
    rootCause:
      'The reservation path reads inventory:available and later writes the decremented value, while cancellation writes a restoration from a concurrent vector-clock branch; neither path uses an atomic conditional update or shared lock, so both can commit from the same stale quantity.',
    impact:
      'Hot SKUs briefly report more units reserved than exist, producing oversells, fulfillment reversals, and manual compensating refunds while request availability remains mostly healthy.',
    remediationIntent:
      'Make the quantity transition a single compare-and-swap/serializable update, include the reservation version in the write predicate, and reject stale vector-clock branches for the same SKU.',
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
    title: 'Cascading Retry Storm',
    category: 'retry-storm',
    serviceArea: 'API gateway / catalog dependency mesh',
    summary:
      'Retries without a shared budget or jitter multiply load after a catalog dependency begins returning transient 503s.',
    rootCause:
      'The gateway, catalog facade, and recommendation client each retry the same request independently; exponential backoff resets at every hop, so one failed catalog call fans out into several synchronized attempts and consumes the downstream quota.',
    impact:
      'A transient catalog brownout becomes a fleet-wide saturation event: healthy requests are evicted from queues, p95 latency reaches seconds, and downstream recovery is delayed by self-generated traffic.',
    remediationIntent:
      'Propagate one deadline and retry budget per request, retry only idempotent operations with full jitter, honor Retry-After, and use a per-dependency circuit breaker plus load-shedding queue.',
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
] as const satisfies readonly IncidentScenario[];

/** Alias retained for callers that use the shorter scenario-oriented name. */
export const SCENARIO_PRESETS = INCIDENT_PRESETS;

/** Lower-camel-case alias for JavaScript consumers. */
export const scenarioPresets = INCIDENT_PRESETS;

/**
 * Return a preset by stable id.
 *
 * The first overload gives known ids a non-optional result, while the string
 * overload keeps runtime callers safe when an id comes from a URL or config.
 */
export function getScenarioPreset(id: ScenarioId): IncidentScenario;
export function getScenarioPreset(id: string): IncidentScenario | undefined;
export function getScenarioPreset(id: string): IncidentScenario | undefined {
  return INCIDENT_PRESETS.find((scenario) => scenario.id === id);
}
