/**
 * S7 — Referential integrity under id reuse (production scenario).
 *
 * A realistic two-table workflow (`users` + `orders`, with `orders.userId` as
 * a foreign key) driven end-to-end through the public API: SheetsAdapter in
 * its default `auto` id mode, backed by @gsquery/core/testing fakes, wired
 * into a SheetsDB and queried with `joinQuery()`.
 *
 * The scenario exercises the interaction nobody tests in isolation: `auto` ids
 * are allocated as `max(id) + 1` (SheetsAdapter.getNextId), so deleting the
 * highest-numbered row hands its id straight to the next insert. Any row in
 * another table still pointing at the deleted id silently re-points at the new
 * occupant. Nothing in the library detects this — there are no foreign keys,
 * no cascade, and no tombstones.
 *
 * These tests pin the behavior as it is today; they do not assert what a
 * relational database would do.
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
    'silently re-points an orphaned order at the new owner of a reused id ' +
      '[documents: id-reuse-dangling-join]',
    () => {
      harness = setupHarness()
      const { db } = harness

      seedUsersAndOrders(db)

      // Eve is the highest-numbered user. Deleting her frees id 5 — auto mode
      // allocates max(id) + 1, and after the delete max(id) is 4.
      db.from('users').delete(5)
      expect(db.from('users').findAll().map(u => u.id)).toEqual([1, 2, 3, 4])

      // Order 5 is now an orphan: it still stores userId 5, and no user has it.
      expect(db.from('orders').findById(5).userId).toBe(5)
      expect(db.from('users').repo.exists(5)).toBe(false)
      expect(joinedUser(ordersWithUser(db)[4])).toBeNull()

      // A brand-new, unrelated signup. No error, no warning: it receives the
      // id the deleted user used to own.
      const frank = db.from('users').create({ name: 'Frank', email: 'frank@corp.test' })
      expect(frank.id).toBe(5)

      const joined = ordersWithUser(db)

      // THE DEFECT: order 5 was Eve's. It now reports Frank as its user, with
      // no error, no null, and no way for the caller to tell.
      expect(joined[4]).toEqual({
        id: 5,
        userId: 5,
        item: 'item-5',
        amount: 50,
        user: { id: 5, name: 'Frank', email: 'frank@corp.test' },
      })
      expect(joinedUser(joined[4])?.name).toBe('Frank')

      // Every other order is unaffected, so nothing about the result set looks
      // suspicious — the corruption is a single silently-rebound row.
      expect(joined.map(o => [o.id, joinedUser(o)?.name])).toEqual([
        [1, 'Alice'],
        [2, 'Bob'],
        [3, 'Carol'],
        [4, 'Dave'],
        [5, 'Frank'],
      ])

      // An inner join keeps it too: the FK resolves, so it is not filtered out.
      const inner = db
        .from('orders')
        .joinQuery()
        .innerJoin('users', 'userId', 'id', { as: 'user' })
        .orderBy('id')
        .exec()
      expect(inner).toHaveLength(5)
      expect(joinedUser(inner[4])?.name).toBe('Frank')
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

  it('reuses the id again after the reused row is itself deleted', () => {
    harness = setupHarness()
    const { db } = harness

    seedUsersAndOrders(db)

    // Repeated churn at the tail keeps handing out the same id, so a table
    // that only ever appends at the end can bind one FK value to a whole
    // sequence of unrelated records over its lifetime.
    for (const name of ['Frank', 'Grace', 'Heidi']) {
      db.from('users').delete(5)
      const created = db.from('users').create({ name, email: `${name.toLowerCase()}@corp.test` })
      expect(created.id).toBe(5)
    }

    expect(joinedUser(ordersWithUser(db)[4])).toEqual({
      id: 5,
      name: 'Heidi',
      email: 'heidi@corp.test',
    })
  })
})
