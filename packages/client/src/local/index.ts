// Local-first adapter components
export { MutationQueue } from './mutation-queue.js'
export type { MutationQueueOptions, MutationStorage } from './mutation-queue.js'

export { LocalAdapter, openSharedIDB } from './local-adapter.js'
export type { LocalAdapterOptions } from './local-adapter.js'

export { SyncEngine, SyncError } from './sync-engine.js'
export type { SyncEngineOptions, TableSyncError } from './sync-engine.js'

export { createClientDB } from './create-client-db.js'
export type { CreateClientDBOptions, ClientDBResult, ClientDBSchema } from './create-client-db.js'

// Types
export type {
  SyncTransport,
  SyncPushResult,
  Mutation,
  MutationType,
  MergedMutation,
  ConflictItem,
  ConflictStrategy,
  SyncEvent,
  SyncEventType,
  SyncEventListener,
  PoisonedMutationInfo,
  PoisonedMutationAction,
  PoisonedMutationHandler,
  RejectedMutationIds,
} from './sync-transport.js'
