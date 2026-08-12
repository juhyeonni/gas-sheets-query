/**
 * S7 — Referential integrity under id reuse (production scenario).
 *
 * A realistic two-table workflow (`users` + `orders`, with `orders.userId` as
 * a foreign key) driven end-to-end through the public API: SheetsAdapter in
 * its default `auto` id mode, backed by @gsquery/core/testing fakes, wired
 * into a SheetsDB and queried with `joinQuery()`.
 *
 * The scenario exercises the interaction nobody tests in isolation: `auto` ids
 * used to be allocated as `max(id) + 1`, so deleting the highest-numbered row
 * handed its id straight to the next insert, and any row in another table
 * still pointing at the deleted id silently re-pointed at the new occupant
 * (#177). Since the fix, allocation goes through a persistent monotonic
 * counter (the `_gsquery_meta` sheet), so a deleted id is never re-issued: the
 * orphaned FK stays a visible orphan (left join → null, inner join → dropped)
 * instead of silently rebinding.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { SheetsAdapter, createSheetsDB } from '../../src/index'
import type { RowWithId, SheetsDB } from '../../src/index'
import { installGasFakes, fromArrays } from '../../src/testing/index'
import type { GasFakesHandle } from '../../src/testing/index'

const SPREADSHEET_ID = 'referential-integrity-scenario'

interface User extends RowWithId {
  id: number
  name: string
  email: string
}

interface Order extends RowWithId {
  id: number
  userId: number
  item: string
  amount: number
}

type Tables = { users: User; orders: Order }

const USER_COLUMNS = ['id', 'name', 'email']
const ORDER_COLUMNS = ['id', 'userId', 'item', 'amount']

/** A joined order row as `exec()` returns it (left join under the `user` key). */
type JoinedOrder = Order & Record<string, unknown>

/** Reads the joined `user` property of a result row, typed. */
function joinedUser(row: JoinedOrder): User | null {
  return (row.user ?? null) as User | null
}

interface Harness {
  db: SheetsDB<Tables>
  handle: GasFakesHandle
}

/**
 * Two empty sheets (header rows only) behind SheetsAdapters in the default
 * `auto` id mode, wired into a SheetsDB so `joinQuery()` can resolve stores.
 */
function setupHarness(): Harness {
  const spreadsheet = fromArrays(
    {
      Users: [USER_COLUMNS],
      Orders: [ORDER_COLUMNS],
    },
    'ReferentialIntegrityScenario'
  )

  const handle = installGasFakes({
    spreadsheets: { [SPREADSHEET_ID]: spreadsheet },
    activeId: SPREADSHEET_ID,
  })

  const users = new SheetsAdapter<User>({
    spreadsheetId: SPREADSHEET_ID,
    sheetName: 'Users',
    columns: USER_COLUMNS,
  })
  const orders = new SheetsAdapter<Order>({
    spreadsheetId: SPREADSHEET_ID,
    sheetName: 'Orders',
    columns: ORDER_COLUMNS,
  })

  const db = createSheetsDB<Tables>({
    config: {
      tables: {
        users: { columns: ['id', 'name', 'email'], sheetName: 'Users' },
        orders: { columns: ['id', 'userId', 'item', 'amount'], sheetName: 'Orders' },
      },
    },
    stores: { users, orders },
  })

  return { db, handle }
}

/** Seeds 5 users and one order per user, mirroring a small live dataset. */
function seedUsersAndOrders(db: SheetsDB<Tables>): void {
  const names = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve']
  for (const name of names) {
    db.from('users').create({ name, email: `${name.toLowerCase()}@corp.test` })
  }
  for (let i = 1; i <= 5; i++) {
    db.from('orders').create({ userId: i, item: `item-${i}`, amount: i * 10 })
  }
}

function ordersWithUser(db: SheetsDB<Tables>): JoinedOrder[] {
  return db
    .from('orders')
    .joinQuery()
    .leftJoin('users', 'userId', 'id', { as: 'user' })
    .orderBy('id')
    .exec()
}

describe('S7 referential integrity under id reuse', () => {
  let harness: Harness | undefined

  afterEach(() => {
    harness?.handle.restore()
    harness = undefined
  })

  it('allocates sequential auto ids and joins orders to the right users', () => {
    harness = setupHarness()
    const { db } = harness

    seedUsersAndOrders(db)

    expect(db.from('users').findAll().map(u => u.id)).toEqual([1, 2, 3, 4, 5])
    expect(db.from('orders').findAll().map(o => o.id)).toEqual([1, 2, 3, 4, 5])

    // Baseline: every order resolves to its own user.
    expect(ordersWithUser(db).map(o => [o.id, joinedUser(o)?.name])).toEqual([
      [1, 'Alice'],
      [2, 'Bob'],
      [3, 'Carol'],
      [4, 'Dave'],
      [5, 'Eve'],
    ])
  })

  it(
    'never hands a deleted max id to a new insert — the orphan stays visible ' +
      '[regression: #177]',
    () => {
      harness = setupHarness()
      const { db } = harness

      seedUsersAndOrders(db)

      // Eve is the highest-numbered user. Deleting her used to free id 5 for
      // the very next insert (allocation was max(id) + 1).
      db.from('users').delete(5)
      expect(db.from('users').findAll().map(u => u.id)).toEqual([1, 2, 3, 4])

      // Order 5 is now an orphan: it still stores userId 5, and no user has it.
      expect(db.from('orders').findById(5).userId).toBe(5)
      expect(db.from('users').repo.exists(5)).toBe(false)
      expect(joinedUser(ordersWithUser(db)[4])).toBeNull()

      // A brand-new, unrelated signup. The persistent counter remembers id 5
      // was issued, so Frank gets 6 — Eve's order cannot rebind to him.
      const frank = db.from('users').create({ name: 'Frank', email: 'frank@corp.test' })
      expect(frank.id).toBe(6)

      const joined = ordersWithUser(db)

      // Order 5 remains a loud, honest orphan instead of silently becoming
      // Frank's — this exact rebinding happened before the fix.
      expect(joined[4]).toEqual({
        id: 5,
        userId: 5,
        item: 'item-5',
        amount: 50,
        user: null,
      })

      expect(joined.map(o => [o.id, joinedUser(o)?.name ?? null])).toEqual([
        [1, 'Alice'],
        [2, 'Bob'],
        [3, 'Carol'],
        [4, 'Dave'],
        [5, null],
      ])

      // The inner join drops the orphan rather than resolving it to Frank.
      const inner = db
        .from('orders')
        .joinQuery()
        .innerJoin('users', 'userId', 'id', { as: 'user' })
        .orderBy('id')
        .exec()
      expect(inner.map(o => o.id)).toEqual([1, 2, 3, 4])
    }
  )

  it('does not reuse the id of a deleted middle row', () => {
    harness = setupHarness()
    const { db } = harness

    seedUsersAndOrders(db)

    // Carol is not the max id, so her id is not freed for reallocation.
    db.from('users').delete(3)
    expect(db.from('users').findAll().map(u => u.id)).toEqual([1, 2, 4, 5])

    const grace = db.from('users').create({ name: 'Grace', email: 'grace@corp.test' })
    expect(grace.id).toBe(6)
    expect(db.from('users').findAll().map(u => u.id)).toEqual([1, 2, 4, 5, 6])
  })

  it('left-joins a dangling FK to null and inner-joins it away (delete-middle)', () => {
    harness = setupHarness()
    const { db } = harness

    seedUsersAndOrders(db)
    db.from('users').delete(3)
    db.from('users').create({ name: 'Grace', email: 'grace@corp.test' })

    // Left join: the orphan row is KEPT, with the joined property set to null
    // (not undefined, not omitted, and the row is not dropped).
    const left = ordersWithUser(db)
    expect(left).toHaveLength(5)
    expect(left[2]).toEqual({
      id: 3,
      userId: 3,
      item: 'item-3',
      amount: 30,
      user: null,
    })
    expect(Object.prototype.hasOwnProperty.call(left[2], 'user')).toBe(true)
    expect(left.map(o => [o.id, joinedUser(o)?.name ?? null])).toEqual([
      [1, 'Alice'],
      [2, 'Bob'],
      [3, null],
      [4, 'Dave'],
      [5, 'Eve'],
    ])

    // Inner join: the orphan row is DROPPED.
    const inner = db
      .from('orders')
      .joinQuery()
      .innerJoin('users', 'userId', 'id', { as: 'user' })
      .orderBy('id')
      .exec()
    expect(inner.map(o => o.id)).toEqual([1, 2, 4, 5])
    expect(
      db
        .from('orders')
        .joinQuery()
        .innerJoin('users', 'userId', 'id', { as: 'user' })
        .count()
    ).toBe(4)
  })

  it('keeps ids unique under repeated delete-max churn [regression: #177]', () => {
    harness = setupHarness()
    const { db } = harness

    seedUsersAndOrders(db)

    // Repeated churn at the tail used to hand out id 5 over and over, binding
    // one FK value to a whole sequence of unrelated records. The counter only
    // moves forward: every re-signup gets a fresh id.
    let expected = 5
    for (const name of ['Frank', 'Grace', 'Heidi']) {
      db.from('users').delete(expected)
      const created = db.from('users').create({ name, email: `${name.toLowerCase()}@corp.test` })
      expected += 1
      expect(created.id).toBe(expected)
    }

    // Eve's order still points at id 5, which no user ever holds again.
    expect(joinedUser(ordersWithUser(db)[4])).toBeNull()
  })
})
