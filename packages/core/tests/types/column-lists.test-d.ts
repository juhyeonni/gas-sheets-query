/**
 * Compile-time contract for column lists (#246).
 *
 * Checked by tsc through Vitest's typecheck mode, never executed: each
 * `@ts-expect-error` must match a real error on the line below it, or the run
 * fails with "Unused '@ts-expect-error' directive".
 */
import { describe, it, expectTypeOf } from 'vitest'
import { SheetsAdapter, MockAdapter, createSheetsDB, defineSheetsDB } from '../../src/index.js'
import type {
  RowWithId,
  SheetsAdapterOptions,
  SheetsDBConfig,
  SheetsDBTableConfig,
  TableSchema,
  TypedSheetsDBConfig
} from '../../src/index.js'

interface User {
  id: number
  name: string
  email: string
}

/**
 * `id` plus only optional fields. Its id is exactly RowWithId's, so the bare
 * RowWithId is assignable to it: only an exact-type check tells them apart.
 */
interface Profile {
  id: string | number
  nickname?: string
  bio?: string
}

describe('SheetsAdapterOptions.columns', () => {
  it('rejects a column that is not a key of the row type (AC1)', () => {
    new SheetsAdapter<User>({
      sheetName: 'Users',
      // @ts-expect-error 'emial' is not a key of User
      columns: ['id', 'emial']
    })

    const options: SheetsAdapterOptions<User> = {
      sheetName: 'Users',
      // @ts-expect-error 'emial' is not a key of User
      columns: ['id', 'name', 'emial']
    }
    expectTypeOf(options.columns).toEqualTypeOf<readonly ('id' | 'name' | 'email')[]>()
  })

  it("accepts only the row type's keys, as a mutable array or an as-const tuple (AC2)", () => {
    new SheetsAdapter<User>({ sheetName: 'Users', columns: ['id', 'name', 'email'] })

    const mutable: (keyof User)[] = ['id', 'name', 'email']
    new SheetsAdapter<User>({ sheetName: 'Users', columns: mutable })

    const tuple = ['id', 'name', 'email'] as const
    new SheetsAdapter<User>({ sheetName: 'Users', columns: tuple })
  })

  it('rejects a plain string[] for a typed row (migration: type it as the keys)', () => {
    const names: string[] = ['id', 'name', 'email']
    // @ts-expect-error string[] is wider than User's keys
    new SheetsAdapter<User>({ sheetName: 'Users', columns: names })
  })

  it('accepts any string when no row type is given (AC3)', () => {
    const adapter = new SheetsAdapter({ sheetName: 'Anything', columns: ['id', 'whatever', 'goes'] })
    expectTypeOf(adapter).toEqualTypeOf<SheetsAdapter<RowWithId>>()

    const names: string[] = ['id', 'free', 'form']
    new SheetsAdapter({ sheetName: 'Anything', columns: names })
    new SheetsAdapter<RowWithId>({ sheetName: 'Anything', columns: names })

    const loose: SheetsAdapterOptions = { sheetName: 'Anything', columns: names }
    expectTypeOf(loose.columns).toEqualTypeOf<readonly string[]>()
  })

  it('still checks a row type of id plus only optional fields (AC4)', () => {
    new SheetsAdapter<Profile>({ sheetName: 'Profiles', columns: ['id', 'nickname', 'bio'] })

    new SheetsAdapter<Profile>({
      sheetName: 'Profiles',
      // @ts-expect-error 'avatar' is not declared on Profile
      columns: ['id', 'nickname', 'avatar']
    })
  })
})

describe('createSheetsDB config', () => {
  it("rejects a table's column that is not a key of its row type (AC5)", () => {
    createSheetsDB<{ users: User }>({
      config: {
        tables: {
          users: {
            // @ts-expect-error 'emial' is not a key of User
            columns: ['id', 'name', 'emial']
          }
        }
      },
      stores: { users: new MockAdapter<User>() }
    })
  })

  it("accepts a list of only the row type's keys (AC5)", () => {
    const db = createSheetsDB<{ users: User; profiles: Profile }>({
      config: {
        tables: {
          users: { columns: ['id', 'name', 'email'], sheetName: 'Users' },
          profiles: { columns: ['id', 'nickname', 'bio'] as const }
        }
      },
      stores: { users: new MockAdapter<User>(), profiles: new MockAdapter<Profile>() }
    })
    expectTypeOf(db.config).toEqualTypeOf<SheetsDBConfig>()
  })

  it('checks a row type of id plus only optional fields (AC4, AC5)', () => {
    createSheetsDB<{ profiles: Profile }>({
      config: {
        tables: {
          profiles: {
            // @ts-expect-error 'avatar' is not declared on Profile
            columns: ['id', 'avatar']
          }
        }
      },
      stores: { profiles: new MockAdapter<Profile>() }
    })
  })

  it('needs a config entry for every table in Tables, as stores already did', () => {
    createSheetsDB<{ users: User; profiles: Profile }>({
      // @ts-expect-error 'profiles' has a store but no config entry
      config: { tables: { users: { columns: ['id', 'name', 'email'] } } },
      stores: { users: new MockAdapter<User>(), profiles: new MockAdapter<Profile>() }
    })
  })

  it('accepts arbitrary column names with no type argument and untyped stores (AC6)', () => {
    const db = createSheetsDB({
      config: { tables: { users: { columns: ['id', 'anything', 'at', 'all'] } } },
      stores: { users: new MockAdapter() }
    })
    expectTypeOf(db.from('users').findAll()).toEqualTypeOf<RowWithId[]>()
  })

  it('accepts the shape the CLI generator emits (AC7)', () => {
    // Mirrors `gsquery generate`'s client.ts; the CLI's own test compiles the
    // generator's real output.
    const schema = {
      tables: {
        Post: { columns: ['id', 'title', 'authorId'] as const },
        User: { columns: ['id', 'email', 'name'] as const, sheetName: 'Users' }
      }
    } as const
    interface Post { id: number; title: string; authorId?: number }
    interface GeneratedUser { id: number; email: string; name?: string }
    type Tables = { Post: Post; User: GeneratedUser }

    createSheetsDB<Tables>({
      config: schema,
      stores: { Post: new MockAdapter<Post>(), User: new MockAdapter<GeneratedUser>() }
    })
  })
})

describe('legacy config types', () => {
  it('SheetsDBConfig holds plain string column lists, never any (AC9)', () => {
    type Table = SheetsDBConfig['tables'][string]
    expectTypeOf<Table>().not.toBeAny()
    expectTypeOf<Table['columns']>().not.toBeAny()
    expectTypeOf<Table['columns']>().toEqualTypeOf<readonly string[]>()
    expectTypeOf<TableSchema['columns']>().toEqualTypeOf<readonly string[]>()
    expectTypeOf<TableSchema<User>['columns']>().toEqualTypeOf<readonly ('id' | 'name' | 'email')[]>()
  })

  it('accepts a config built at runtime from a runtime schema (D5)', () => {
    const runtimeColumns: readonly string[] = ['id', 'a', 'b']
    const config: SheetsDBConfig = {
      tables: Object.fromEntries([['things', { columns: [...runtimeColumns], sheetName: 'Things' }]])
    }
    expectTypeOf(config.tables).toEqualTypeOf<Record<string, SheetsDBTableConfig>>()
  })

  it('erases a typed config to SheetsDBConfig, but not the other way round', () => {
    const typed: TypedSheetsDBConfig<{ users: User }> = {
      tables: { users: { columns: ['id', 'name', 'email'] } }
    }
    const erased: SheetsDBConfig = typed
    expectTypeOf(typed).toExtend<SheetsDBConfig>()

    createSheetsDB<{ users: User }>({
      // @ts-expect-error an erased config's string columns are wider than User's keys
      config: erased,
      stores: { users: new MockAdapter<User>() }
    })
  })

  it('leaves defineSheetsDB inference unchanged', () => {
    const db = defineSheetsDB({
      tables: { users: { columns: ['id', 'name'] as const, types: { id: 0, name: '' } } },
      mock: true
    })
    expectTypeOf(db.config).toEqualTypeOf<SheetsDBConfig>()
  })
})
