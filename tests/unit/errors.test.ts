/**
 * Tests for custom error classes
 */
import { describe, it, expect } from 'vitest'
import {
  SheetsQueryError,
  TableNotFoundError,
  RowNotFoundError,
  NoResultsError,
  MissingStoreError,
  ValidationError,
  InvalidOperatorError,
  defineSheetsDB,
  MockAdapter
} from '../../src'

describe('Custom Error Classes', () => {
  describe('SheetsQueryError', () => {
    it('should have correct name and code', () => {
      const error = new SheetsQueryError('Test error', 'TEST_CODE')
      
      expect(error.name).toBe('SheetsQueryError')
      expect(error.code).toBe('TEST_CODE')
      expect(error.message).toBe('Test error')
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(SheetsQueryError)
    })
  })

  describe('TableNotFoundError', () => {
    it('should include table name and available tables', () => {
      const error = new TableNotFoundError('posts', ['users', 'comments'])
      
      expect(error.name).toBe('TableNotFoundError')
      expect(error.code).toBe('TABLE_NOT_FOUND')
      expect(error.tableName).toBe('posts')
      expect(error.availableTables).toEqual(['users', 'comments'])
      expect(error.message).toBe('Table "posts" not found. Available: users, comments')
    })

    it('should be thrown when accessing unknown table', () => {
      const db = defineSheetsDB({
        tables: {
          users: {
            columns: ['id', 'name'] as const,
            types: { id: 0, name: '' }
          }
        },
        stores: { users: new MockAdapter() }
      })

      try {
        db.from('unknown' as 'users')
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(TableNotFoundError)
        expect((e as TableNotFoundError).tableName).toBe('unknown')
      }
    })
  })

  describe('RowNotFoundError', () => {
    it('should include id and optional table name', () => {
      const error1 = new RowNotFoundError(123)
      expect(error1.message).toBe('Row with id "123" not found')
      expect(error1.id).toBe(123)
      expect(error1.tableName).toBeUndefined()

      const error2 = new RowNotFoundError('abc', 'users')
      expect(error2.message).toBe('Row with id "abc" not found in table "users"')
      expect(error2.tableName).toBe('users')
    })

    it('should be thrown when row not found', () => {
      const db = defineSheetsDB({
        tables: {
          users: {
            columns: ['id', 'name'] as const,
            types: { id: 0, name: '' }
          }
        },
        stores: { users: new MockAdapter() }
      })

      try {
        db.from('users').findById(999)
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(RowNotFoundError)
        expect((e as RowNotFoundError).id).toBe(999)
        expect((e as RowNotFoundError).tableName).toBe('users')
      }
    })
  })

  describe('NoResultsError', () => {
    it('should work with and without table name', () => {
      const error1 = new NoResultsError()
      expect(error1.message).toBe('No results found')
      expect(error1.code).toBe('NO_RESULTS')

      const error2 = new NoResultsError('users')
      expect(error2.message).toBe('No results found in table "users"')
    })

    it('should be thrown by firstOrFail', () => {
      const db = defineSheetsDB({
        tables: {
          users: {
            columns: ['id', 'name'] as const,
            types: { id: 0, name: '' }
          }
        },
        stores: { users: new MockAdapter() }
      })

      try {
        db.from('users').query().where('name', '=', 'nonexistent').firstOrFail()
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(NoResultsError)
      }
    })
  })

  describe('MissingStoreError', () => {
    it('should include table name', () => {
      const error = new MissingStoreError('posts')
      
      expect(error.name).toBe('MissingStoreError')
      expect(error.code).toBe('MISSING_STORE')
      expect(error.tableName).toBe('posts')
      expect(error.message).toBe('Missing store for table "posts"')
    })
  })

  describe('ValidationError', () => {
    it('should include optional field', () => {
      const error1 = new ValidationError('Invalid input')
      expect(error1.field).toBeUndefined()

      const error2 = new ValidationError('Email is invalid', 'email')
      expect(error2.field).toBe('email')
      expect(error2.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('InvalidOperatorError', () => {
    it('should include operator and valid operators', () => {
      const error = new InvalidOperatorError('===', ['=', '!=', '>', '<'])
      
      expect(error.operator).toBe('===')
      expect(error.validOperators).toEqual(['=', '!=', '>', '<'])
      expect(error.message).toBe('Invalid operator "===". Valid operators: =, !=, >, <')
    })
  })

  describe('Error inheritance', () => {
    it('all errors should extend SheetsQueryError', () => {
      expect(new TableNotFoundError('t', [])).toBeInstanceOf(SheetsQueryError)
      expect(new RowNotFoundError(1)).toBeInstanceOf(SheetsQueryError)
      expect(new NoResultsError()).toBeInstanceOf(SheetsQueryError)
      expect(new MissingStoreError('t')).toBeInstanceOf(SheetsQueryError)
      expect(new ValidationError('msg')).toBeInstanceOf(SheetsQueryError)
      expect(new InvalidOperatorError('x', [])).toBeInstanceOf(SheetsQueryError)
    })

    it('all errors should be instanceof Error', () => {
      expect(new TableNotFoundError('t', [])).toBeInstanceOf(Error)
      expect(new RowNotFoundError(1)).toBeInstanceOf(Error)
    })
  })
})
