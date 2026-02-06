import { describe, it, expect, beforeEach } from 'vitest'
import {
  MigrationRunner,
  createMigrationRunner,
  MigrationVersionError,
  MigrationExecutionError,
  NoMigrationsToRollbackError
} from '../../src/core/migration'
import type { Migration, MigrationRecord, StoreResolver } from '../../src/core/migration'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import type { DataStore, Row } from '../../src/core/types'

interface User {
  id: number
  name: string
  email: string
  role?: string
  status?: string
  newName?: string
}

interface Post {
  id: number
  title: string
  userId: number
  category?: string
}

describe('MigrationRunner', () => {
  let migrationsStore: MockAdapter<MigrationRecord>
  let usersStore: MockAdapter<User>
  let postsStore: MockAdapter<Post>
  let storeResolver: StoreResolver
  
  beforeEach(() => {
    migrationsStore = new MockAdapter<MigrationRecord>()
    usersStore = new MockAdapter<User>()
    postsStore = new MockAdapter<Post>()
    
    storeResolver = <T extends Row>(tableName: string): DataStore<T> => {
      switch (tableName) {
        case 'users':
          return usersStore as unknown as DataStore<T>
        case 'posts':
          return postsStore as unknown as DataStore<T>
        default:
          throw new Error(`Unknown table: ${tableName}`)
      }
    }
  })

  describe('validation', () => {
    it('should reject invalid version numbers', () => {
      expect(() => createMigrationRunner({
        migrationsStore,
        storeResolver,
        migrations: [{
          version: 0,
          name: 'invalid',
          up: () => {},
          down: () => {}
        }]
      })).toThrow(MigrationVersionError)
      
      expect(() => createMigrationRunner({
        migrationsStore,
        storeResolver,
        migrations: [{
          version: -1,
          name: 'invalid',
          up: () => {},
          down: () => {}
        }]
      })).toThrow(MigrationVersionError)
      
      expect(() => createMigrationRunner({
        migrationsStore,
        storeResolver,
        migrations: [{
          version: 1.5,
          name: 'invalid',
          up: () => {},
          down: () => {}
        }]
      })).toThrow(MigrationVersionError)
    })
    
    it('should reject duplicate versions', () => {
      expect(() => createMigrationRunner({
        migrationsStore,
        storeResolver,
        migrations: [
          { version: 1, name: 'first', up: () => {}, down: () => {} },
          { version: 1, name: 'duplicate', up: () => {}, down: () => {} }
        ]
      })).toThrow(MigrationVersionError)
    })
    
    it('should reject migrations without name', () => {
      expect(() => createMigrationRunner({
        migrationsStore,
        storeResolver,
        migrations: [{
          version: 1,
          name: '',
          up: () => {},
          down: () => {}
        }]
      })).toThrow(MigrationVersionError)
    })
  })

  describe('getCurrentVersion', () => {
    it('should return 0 when no migrations applied', () => {
      const runner = createMigrationRunner({
        migrationsStore,
        storeResolver,
        migrations: []
      })
      
      expect(runner.getCurrentVersion()).toBe(0)
    })
    
    it('should return highest applied version', () => {
      migrationsStore.insert({ version: 1, name: 'first', appliedAt: '2024-01-01' })
      migrationsStore.insert({ version: 3, name: 'third', appliedAt: '2024-01-03' })
      migrationsStore.insert({ version: 2, name: 'second', appliedAt: '2024-01-02' })
      
      const runner = createMigrationRunner({
        migrationsStore,
        storeResolver,
        migrations: []
      })
      
      expect(runner.getCurrentVersion()).toBe(3)
    })
  })

  describe('getPendingMigrations', () => {
    it('should return all migrations when none applied', () => {
      const migrations: Migration[] = [
        { version: 1, name: 'first', up: () => {}, down: () => {} },
        { version: 2, name: 'second', up: () => {}, down: () => {} }
      ]
      
      const runner = createMigrationRunner({
        migrationsStore,
        storeResolver,
        migrations
      })
      
      const pending = runner.getPendingMigrations()
      expect(pending.length).toBe(2)
      expect(pending[0].version).toBe(1)
      expect(pending[1].version).toBe(2)
    })
    
    it('should exclude applied migrations', () => {
      migrationsStore.insert({ version: 1, name: 'first', appliedAt: '2024-01-01' })
      
      const migrations: Migration[] = [
        { version: 1, name: 'first', up: () => {}, down: () => {} },
        { version: 2, name: 'second', up: () => {}, down: () => {} },
        { version: 3, name: 'third', up: () => {}, down: () => {} }
      ]
      
      const runner = createMigrationRunner({
        migrationsStore,
        storeResolver,
        migrations
      })
      
      const pending = runner.getPendingMigrations()
      expect(pending.length).toBe(2)
      expect(pending[0].version).toBe(2)
      expect(pending[1].version).toBe(3)
    })
  })

  describe('migrate', () => {
    it('should apply all pending migrations in order', async () => {
      // Add initial data
      usersStore.insert({ name: 'John', email: 'john@test.com' })
      usersStore.insert({ name: 'Jane', email: 'jane@test.com' })
      
      const migrations: Migration[] = [
        {
          version: 1,
          name: 'add_role_to_users',
          up: (db) => {
            db.addColumn('users', 'role', { default: 'user' })
          },
          down: (db) => {
            db.removeColumn('users', 'role')
          }
        },
        {
          version: 2,
          name: 'add_status_to_users',
          up: (db) => {
            db.addColumn('users', 'status', { default: 'active' })
          },
          down: (db) => {
            db.removeColumn('users', 'status')
          }
        }
      ]
      
      const runner = createMigrationRunner({
        migrationsStore,
        storeResolver,
        migrations
      })
      
      const result = await runner.migrate()
      
      expect(result.applied.length).toBe(2)
      expect(result.applied[0].version).toBe(1)
      expect(result.applied[1].version).toBe(2)
      expect(result.currentVersion).toBe(2)
      
      // Check data was updated
      const users = usersStore.findAll()
      expect(users[0].role).toBe('user')
      expect(users[0].status).toBe('active')
      expect(users[1].role).toBe('user')
      expect(users[1].status).toBe('active')
      
      // Check migration records
      const records = migrationsStore.findAll()
      expect(records.length).toBe(2)
    })
    
    it('should stop at target version', async () => {
      usersStore.insert({ name: 'John', email: 'john@test.com' })
      
      const migrations: Migration[] = [
        { version: 1, name: 'first', up: (db) => db.addColumn('users', 'role', { default: 'user' }), down: () => {} },
        { version: 2, name: 'second', up: (db) => db.addColumn('users', 'status', { default: 'active' }), down: () => {} },
        { version: 3, name: 'third', up: (db) => db.addColumn('users', 'extra'), down: () => {} }
      ]
      
      const runner = createMigrationRunner({
        migrationsStore,
        storeResolver,
        migrations
      })
      
      const result = await runner.migrate({ to: 2 })
      
      expect(result.applied.length).toBe(2)
      expect(result.currentVersion).toBe(2)
      
      const users = usersStore.findAll()
      expect(users[0].role).toBe('user')
      expect(users[0].status).toBe('active')
    })
    
    it('should handle async migrations', async () => {
      usersStore.insert({ name: 'John', email: 'john@test.com' })
      
      const migrations: Migration[] = [
        {
          version: 1,
          name: 'async_migration',
          up: async (db) => {
            await new Promise(resolve => setTimeout(resolve, 10))
            db.addColumn('users', 'role', { default: 'user' })
          },
          down: async () => {
            await new Promise(resolve => setTimeout(resolve, 10))
          }
        }
      ]
      
      const runner = createMigrationRunner({
        migrationsStore,
        storeResolver,
        migrations
      })
      
      const result = await runner.migrate()
      
      expect(result.applied.length).toBe(1)
      expect(usersStore.findAll()[0].role).toBe('user')
    })
    
    it('should throw MigrationExecutionError on failure', async () => {
      const migrations: Migration[] = [
        {
          version: 1,
          name: 'failing_migration',
          up: () => {
            throw new Error('Something went wrong')
          },
          down: () => {}
        }
      ]
      
      const runner = createMigrationRunner({
        migrationsStore,
        storeResolver,
        migrations
      })
      
      await expect(runner.migrate()).rejects.toThrow(MigrationExecutionError)
    })
    
    it('should return empty array when no pending migrations', async () => {
      migrationsStore.insert({ version: 1, name: 'first', appliedAt: '2024-01-01' })
      
      const migrations: Migration[] = [
        { version: 1, name: 'first', up: () => {}, down: () => {} }
      ]
      
      const runner = createMigrationRunner({
        migrationsStore,
        storeResolver,
        migrations
      })
      
      const result = await runner.migrate()
      
      expect(result.applied.length).toBe(0)
      expect(result.currentVersion).toBe(1)
    })
  })

  describe('rollback', () => {
    it('should rollback the last migration', async () => {
      // Setup: apply a migration first
      usersStore.insert({ name: 'John', email: 'john@test.com', role: 'admin' })
      migrationsStore.insert({ version: 1, name: 'add_role', appliedAt: '2024-01-01' })
      
      const migrations: Migration[] = [
        {
          version: 1,
          name: 'add_role',
          up: (db) => {
            db.addColumn('users', 'role', { default: 'user' })
          },
          down: (db) => {
            db.removeColumn('users', 'role')
          }
        }
      ]
      
      const runner = createMigrationRunner({
        migrationsStore,
        storeResolver,
        migrations
      })
      
      const result = await runner.rollback()
      
      expect(result.rolledBack.version).toBe(1)
      expect(result.rolledBack.name).toBe('add_role')
      expect(result.currentVersion).toBe(0)
      
      // Check migration record was removed
      expect(migrationsStore.findAll().length).toBe(0)
    })
    
    it('should throw when no migrations to rollback', async () => {
      const runner = createMigrationRunner({
        migrationsStore,
        storeResolver,
        migrations: []
      })
      
      await expect(runner.rollback()).rejects.toThrow(NoMigrationsToRollbackError)
    })
    
    it('should throw when migration definition not found', async () => {
      migrationsStore.insert({ version: 1, name: 'deleted_migration', appliedAt: '2024-01-01' })
      
      const runner = createMigrationRunner({
        migrationsStore,
        storeResolver,
        migrations: [] // Migration definition removed
      })
      
      await expect(runner.rollback()).rejects.toThrow(MigrationVersionError)
    })
  })

  describe('rollbackAll', () => {
    it('should rollback all migrations in reverse order', async () => {
      usersStore.insert({ name: 'John', email: 'john@test.com', role: 'user', status: 'active' })
      migrationsStore.insert({ version: 1, name: 'add_role', appliedAt: '2024-01-01' })
      migrationsStore.insert({ version: 2, name: 'add_status', appliedAt: '2024-01-02' })
      
      const migrations: Migration[] = [
        {
          version: 1,
          name: 'add_role',
          up: (db) => db.addColumn('users', 'role', { default: 'user' }),
          down: (db) => db.removeColumn('users', 'role')
        },
        {
          version: 2,
          name: 'add_status',
          up: (db) => db.addColumn('users', 'status', { default: 'active' }),
          down: (db) => db.removeColumn('users', 'status')
        }
      ]
      
      const runner = createMigrationRunner({
        migrationsStore,
        storeResolver,
        migrations
      })
      
      const result = await runner.rollbackAll()
      
      expect(result.rolledBack.length).toBe(2)
      expect(result.rolledBack[0].version).toBe(2)
      expect(result.rolledBack[1].version).toBe(1)
      expect(result.currentVersion).toBe(0)
      expect(migrationsStore.findAll().length).toBe(0)
    })
  })

  describe('getStatus', () => {
    it('should return complete migration status', () => {
      migrationsStore.insert({ version: 1, name: 'first', appliedAt: '2024-01-01' })
      
      const migrations: Migration[] = [
        { version: 1, name: 'first', up: () => {}, down: () => {} },
        { version: 2, name: 'second', up: () => {}, down: () => {} }
      ]
      
      const runner = createMigrationRunner({
        migrationsStore,
        storeResolver,
        migrations
      })
      
      const status = runner.getStatus()
      
      expect(status.currentVersion).toBe(1)
      expect(status.applied.length).toBe(1)
      expect(status.pending.length).toBe(1)
      expect(status.pending[0].version).toBe(2)
    })
  })

  describe('schema operations', () => {
    describe('addColumn', () => {
      it('should add column with default value', async () => {
        usersStore.insert({ name: 'John', email: 'john@test.com' })
        usersStore.insert({ name: 'Jane', email: 'jane@test.com' })
        
        const migrations: Migration[] = [
          {
            version: 1,
            name: 'add_role',
            up: (db) => db.addColumn('users', 'role', { default: 'guest' }),
            down: (db) => db.removeColumn('users', 'role')
          }
        ]
        
        const runner = createMigrationRunner({
          migrationsStore,
          storeResolver,
          migrations
        })
        
        await runner.migrate()
        
        const users = usersStore.findAll()
        expect(users[0].role).toBe('guest')
        expect(users[1].role).toBe('guest')
      })
      
      it('should add column without default (undefined)', async () => {
        usersStore.insert({ name: 'John', email: 'john@test.com' })
        
        const migrations: Migration[] = [
          {
            version: 1,
            name: 'add_optional_field',
            up: (db) => db.addColumn('users', 'role'),
            down: (db) => db.removeColumn('users', 'role')
          }
        ]
        
        const runner = createMigrationRunner({
          migrationsStore,
          storeResolver,
          migrations
        })
        
        await runner.migrate()
        
        const users = usersStore.findAll()
        expect(users[0].role).toBeUndefined()
      })
    })

    describe('renameColumn', () => {
      it('should rename column preserving data', async () => {
        usersStore.insert({ name: 'John', email: 'john@test.com' })
        
        const migrations: Migration[] = [
          {
            version: 1,
            name: 'rename_name_to_newName',
            up: (db) => db.renameColumn('users', 'name', 'newName'),
            down: (db) => db.renameColumn('users', 'newName', 'name')
          }
        ]
        
        const runner = createMigrationRunner({
          migrationsStore,
          storeResolver,
          migrations
        })
        
        await runner.migrate()
        
        const users = usersStore.findAll()
        expect(users[0].newName).toBe('John')
      })
    })

    describe('multiple operations in one migration', () => {
      it('should apply multiple operations', async () => {
        usersStore.insert({ name: 'John', email: 'john@test.com' })
        postsStore.insert({ title: 'Hello', userId: 1 })
        
        const migrations: Migration[] = [
          {
            version: 1,
            name: 'multi_table_migration',
            up: (db) => {
              db.addColumn('users', 'role', { default: 'user' })
              db.addColumn('posts', 'category', { default: 'general' })
            },
            down: (db) => {
              db.removeColumn('users', 'role')
              db.removeColumn('posts', 'category')
            }
          }
        ]
        
        const runner = createMigrationRunner({
          migrationsStore,
          storeResolver,
          migrations
        })
        
        await runner.migrate()
        
        expect(usersStore.findAll()[0].role).toBe('user')
        expect(postsStore.findAll()[0].category).toBe('general')
      })
    })
  })
})
