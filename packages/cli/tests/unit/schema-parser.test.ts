/**
 * Schema Parser Tests
 * TDD for #19 - YAML 스키마를 AST로 파싱
 */

import { describe, it, expect } from 'vitest'
import {
  parseFieldType,
  parseFieldAttributes,
  parseField,
  parseEnum,
  parseTable,
  parseBlockAttributeArrays,
  parseSchema,
  validateSchema,
  ParseError,
} from '../../src/parser/schema-parser'

// =============================================================================
// Field Type Parsing
// =============================================================================

describe('parseFieldType', () => {
  it('should parse simple types', () => {
    expect(parseFieldType('string')).toEqual({ type: 'string', optional: false })
    expect(parseFieldType('number')).toEqual({ type: 'number', optional: false })
    expect(parseFieldType('boolean')).toEqual({ type: 'boolean', optional: false })
    expect(parseFieldType('datetime')).toEqual({ type: 'datetime', optional: false })
  })

  it('should parse optional types (with ?)', () => {
    expect(parseFieldType('string?')).toEqual({ type: 'string', optional: true })
    expect(parseFieldType('number?')).toEqual({ type: 'number', optional: true })
  })

  it('should parse enum types', () => {
    expect(parseFieldType('Role')).toEqual({ type: 'Role', optional: false })
    expect(parseFieldType('Status?')).toEqual({ type: 'Status', optional: true })
  })
})

// =============================================================================
// Field Attributes Parsing
// =============================================================================

describe('parseFieldAttributes', () => {
  it('should parse simple attributes', () => {
    const attrs = parseFieldAttributes('@id')
    expect(attrs).toEqual([{ name: 'id', args: [] }])
  })

  it('should parse @unique', () => {
    const attrs = parseFieldAttributes('@unique')
    expect(attrs).toEqual([{ name: 'unique', args: [] }])
  })

  it('should parse @updatedAt', () => {
    const attrs = parseFieldAttributes('@updatedAt')
    expect(attrs).toEqual([{ name: 'updatedAt', args: [] }])
  })

  it('should parse @default with function', () => {
    expect(parseFieldAttributes('@default(autoincrement)')).toEqual([
      { name: 'default', args: ['autoincrement'] }
    ])
    expect(parseFieldAttributes('@default(now)')).toEqual([
      { name: 'default', args: ['now'] }
    ])
  })

  it('should parse @default with literal values', () => {
    expect(parseFieldAttributes('@default(0)')).toEqual([
      { name: 'default', args: [0] }
    ])
    expect(parseFieldAttributes('@default(100)')).toEqual([
      { name: 'default', args: [100] }
    ])
    expect(parseFieldAttributes('@default(true)')).toEqual([
      { name: 'default', args: [true] }
    ])
    expect(parseFieldAttributes('@default(false)')).toEqual([
      { name: 'default', args: [false] }
    ])
  })

  it('should parse @default with string values', () => {
    expect(parseFieldAttributes('@default("#888888")')).toEqual([
      { name: 'default', args: ['#888888'] }
    ])
    expect(parseFieldAttributes('@default("hello")')).toEqual([
      { name: 'default', args: ['hello'] }
    ])
  })

  it('should parse @default with enum values', () => {
    expect(parseFieldAttributes('@default(USER)')).toEqual([
      { name: 'default', args: ['USER'] }
    ])
    expect(parseFieldAttributes('@default(DRAFT)')).toEqual([
      { name: 'default', args: ['DRAFT'] }
    ])
  })

  it('should parse multiple attributes', () => {
    const attrs = parseFieldAttributes('@id @default(autoincrement)')
    expect(attrs).toEqual([
      { name: 'id', args: [] },
      { name: 'default', args: ['autoincrement'] }
    ])
  })
})

// =============================================================================
// Full Field Parsing
// =============================================================================

describe('parseField', () => {
  it('should parse simple field', () => {
    expect(parseField('name', 'string')).toEqual({
      name: 'name',
      type: 'string',
      optional: false,
      attributes: []
    })
  })

  it('should parse optional field', () => {
    expect(parseField('nickname', 'string?')).toEqual({
      name: 'nickname',
      type: 'string',
      optional: true,
      attributes: []
    })
  })

  it('should parse field with attributes', () => {
    expect(parseField('id', 'number @id @default(autoincrement)')).toEqual({
      name: 'id',
      type: 'number',
      optional: false,
      attributes: [
        { name: 'id', args: [] },
        { name: 'default', args: ['autoincrement'] }
      ]
    })
  })

  it('should parse field with @unique', () => {
    expect(parseField('email', 'string @unique')).toEqual({
      name: 'email',
      type: 'string',
      optional: false,
      attributes: [{ name: 'unique', args: [] }]
    })
  })

  it('should parse field with enum type and default', () => {
    expect(parseField('role', 'Role @default(USER)')).toEqual({
      name: 'role',
      type: 'Role',
      optional: false,
      attributes: [{ name: 'default', args: ['USER'] }]
    })
  })

  it('should parse datetime with @default(now)', () => {
    expect(parseField('createdAt', 'datetime @default(now)')).toEqual({
      name: 'createdAt',
      type: 'datetime',
      optional: false,
      attributes: [{ name: 'default', args: ['now'] }]
    })
  })

  it('should parse datetime with @updatedAt', () => {
    expect(parseField('updatedAt', 'datetime @updatedAt')).toEqual({
      name: 'updatedAt',
      type: 'datetime',
      optional: false,
      attributes: [{ name: 'updatedAt', args: [] }]
    })
  })
})

// =============================================================================
// Enum Parsing
// =============================================================================

describe('parseEnum', () => {
  it('should parse enum values', () => {
    expect(parseEnum('Role', ['USER', 'ADMIN', 'MODERATOR'])).toEqual({
      name: 'Role',
      values: ['USER', 'ADMIN', 'MODERATOR']
    })
  })

  it('should parse single value enum', () => {
    expect(parseEnum('SingleValue', ['ONLY'])).toEqual({
      name: 'SingleValue',
      values: ['ONLY']
    })
  })
})

// =============================================================================
// Block Attributes Parsing (New syntax: indexes/unique arrays)
// =============================================================================

describe('parseBlockAttributeArrays', () => {
  it('should parse single index', () => {
    const result = parseBlockAttributeArrays('index', [['ownerId']])
    expect(result).toEqual([
      { name: 'index', fields: ['ownerId'] }
    ])
  })

  it('should parse multiple indexes', () => {
    const result = parseBlockAttributeArrays('index', [
      ['ownerId'],
      ['email', 'createdAt']
    ])
    expect(result).toEqual([
      { name: 'index', fields: ['ownerId'] },
      { name: 'index', fields: ['email', 'createdAt'] }
    ])
  })

  it('should parse unique constraints', () => {
    const result = parseBlockAttributeArrays('unique', [
      ['email'],
      ['projectId', 'name']
    ])
    expect(result).toEqual([
      { name: 'unique', fields: ['email'] },
      { name: 'unique', fields: ['projectId', 'name'] }
    ])
  })

  it('should handle empty array', () => {
    const result = parseBlockAttributeArrays('index', [])
    expect(result).toEqual([])
  })
})

// =============================================================================
// Table Parsing (New syntax: fields/indexes/unique sections)
// =============================================================================

describe('parseTable', () => {
  it('should parse simple table with fields section', () => {
    const raw = {
      fields: {
        id: 'number @id',
        name: 'string',
      }
    }
    const result = parseTable('Simple', raw)
    expect(result).toEqual({
      name: 'Simple',
      fields: [
        { name: 'id', type: 'number', optional: false, attributes: [{ name: 'id', args: [] }] },
        { name: 'name', type: 'string', optional: false, attributes: [] },
      ],
      blockAttributes: []
    })
  })

  it('should parse table with indexes section', () => {
    const raw = {
      fields: {
        id: 'number @id',
        ownerId: 'number',
      },
      indexes: [
        ['ownerId']
      ]
    }
    const result = parseTable('Project', raw)
    expect(result).toEqual({
      name: 'Project',
      fields: [
        { name: 'id', type: 'number', optional: false, attributes: [{ name: 'id', args: [] }] },
        { name: 'ownerId', type: 'number', optional: false, attributes: [] },
      ],
      blockAttributes: [
        { name: 'index', fields: ['ownerId'] }
      ]
    })
  })

  it('should parse table with indexes and unique sections', () => {
    const raw = {
      fields: {
        id: 'number @id',
        projectId: 'number',
        title: 'string',
      },
      indexes: [
        ['projectId']
      ],
      unique: [
        ['projectId', 'title']
      ]
    }
    const result = parseTable('Task', raw)
    expect(result.blockAttributes).toEqual([
      { name: 'index', fields: ['projectId'] },
      { name: 'unique', fields: ['projectId', 'title'] }
    ])
  })

  it('should parse table with multiple indexes', () => {
    const raw = {
      fields: {
        id: 'number @id',
        email: 'string',
        createdAt: 'datetime',
        status: 'string',
      },
      indexes: [
        ['email'],
        ['email', 'createdAt'],
        ['status']
      ]
    }
    const result = parseTable('User', raw)
    expect(result.blockAttributes).toEqual([
      { name: 'index', fields: ['email'] },
      { name: 'index', fields: ['email', 'createdAt'] },
      { name: 'index', fields: ['status'] }
    ])
  })
})

// =============================================================================
// Full Schema Parsing (New syntax)
// =============================================================================

describe('parseSchema', () => {
  it('should parse minimal schema', () => {
    const yaml = `
tables:
  User:
    fields:
      id: number @id
      name: string
`
    const result = parseSchema(yaml)
    expect(result.success).toBe(true)
    expect(result.schema?.tables.User).toBeDefined()
    expect(result.schema?.tables.User.fields).toHaveLength(2)
  })

  it('should parse schema with enums', () => {
    const yaml = `
enums:
  Role:
    - USER
    - ADMIN

tables:
  User:
    fields:
      id: number @id
      role: Role @default(USER)
`
    const result = parseSchema(yaml)
    expect(result.success).toBe(true)
    expect(result.schema?.enums.Role).toEqual({
      name: 'Role',
      values: ['USER', 'ADMIN']
    })
    expect(result.schema?.tables.User.fields[1]).toEqual({
      name: 'role',
      type: 'Role',
      optional: false,
      attributes: [{ name: 'default', args: ['USER'] }]
    })
  })

  it('should parse complex schema with all features', () => {
    const yaml = `
enums:
  Status:
    - OPEN
    - DONE

tables:
  Task:
    fields:
      id: number @id @default(autoincrement)
      title: string
      description: string?
      status: Status @default(OPEN)
      assigneeId: number?
      createdAt: datetime @default(now)
      updatedAt: datetime @updatedAt
    indexes:
      - [status]
    unique:
      - [title]
`
    const result = parseSchema(yaml)
    expect(result.success).toBe(true)
    
    const task = result.schema?.tables.Task
    expect(task).toBeDefined()
    expect(task?.fields).toHaveLength(7)
    
    // Check optional field
    const description = task?.fields.find(f => f.name === 'description')
    expect(description?.optional).toBe(true)
    
    // Check enum field with default
    const status = task?.fields.find(f => f.name === 'status')
    expect(status?.type).toBe('Status')
    expect(status?.attributes).toContainEqual({ name: 'default', args: ['OPEN'] })
    
    // Check block attributes
    expect(task?.blockAttributes).toContainEqual({ name: 'index', fields: ['status'] })
    expect(task?.blockAttributes).toContainEqual({ name: 'unique', fields: ['title'] })
  })

  it('should return errors for invalid YAML', () => {
    const yaml = `
this is not valid yaml:
  - [ unbalanced
`
    const result = parseSchema(yaml)
    expect(result.success).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('should handle empty schema', () => {
    const yaml = ``
    const result = parseSchema(yaml)
    expect(result.success).toBe(true)
    expect(result.schema?.enums).toEqual({})
    expect(result.schema?.tables).toEqual({})
  })

  it('should parse composite indexes', () => {
    const yaml = `
tables:
  Task:
    fields:
      id: number @id
      projectId: number
      assigneeId: number
      status: string
    indexes:
      - [projectId]
      - [assigneeId]
      - [projectId, status]
`
    const result = parseSchema(yaml)
    expect(result.success).toBe(true)
    expect(result.schema?.tables.Task.blockAttributes).toEqual([
      { name: 'index', fields: ['projectId'] },
      { name: 'index', fields: ['assigneeId'] },
      { name: 'index', fields: ['projectId', 'status'] }
    ])
  })
})

// =============================================================================
// Error Handling
// =============================================================================

describe('Error Handling', () => {
  it('should detect missing @id in malformed table definition', () => {
    const yaml = `
tables:
  User:
    id: number @id
    email: string @unknown_attribute
`
    const result = parseSchema(yaml)
    // Table has no 'fields' key, so fields array is empty → no @id → validation fails
    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("must have an @id field") })
    )
  })
})

// =============================================================================
// Semantic Validation (Issue #29)
// =============================================================================

describe('validateSchema', () => {
  it('should return no errors for a valid schema', () => {
    const errors = validateSchema({
      enums: {
        Role: { name: 'Role', values: ['USER', 'ADMIN'] },
      },
      tables: {
        User: {
          name: 'User',
          fields: [
            { name: 'id', type: 'number', optional: false, attributes: [{ name: 'id', args: [] }] },
            { name: 'name', type: 'string', optional: false, attributes: [] },
            { name: 'role', type: 'Role', optional: false, attributes: [{ name: 'default', args: ['USER'] }] },
          ],
          blockAttributes: [],
        },
      },
    })
    expect(errors).toEqual([])
  })

  // Rule 1: Field type must be built-in or defined enum
  it('should error on unknown field type', () => {
    const errors = validateSchema({
      enums: {},
      tables: {
        User: {
          name: 'User',
          fields: [
            { name: 'id', type: 'number', optional: false, attributes: [{ name: 'id', args: [] }] },
            { name: 'data', type: 'json', optional: false, attributes: [] },
          ],
          blockAttributes: [],
        },
      },
    })
    expect(errors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("Unknown type 'json'") })
    )
  })

  it('should accept enum type as valid field type', () => {
    const errors = validateSchema({
      enums: {
        Status: { name: 'Status', values: ['OPEN', 'DONE'] },
      },
      tables: {
        Task: {
          name: 'Task',
          fields: [
            { name: 'id', type: 'number', optional: false, attributes: [{ name: 'id', args: [] }] },
            { name: 'status', type: 'Status', optional: false, attributes: [] },
          ],
          blockAttributes: [],
        },
      },
    })
    expect(errors).toEqual([])
  })

  // Rule 2: Exactly one @id field
  it('should error when table has no @id field', () => {
    const errors = validateSchema({
      enums: {},
      tables: {
        User: {
          name: 'User',
          fields: [
            { name: 'name', type: 'string', optional: false, attributes: [] },
          ],
          blockAttributes: [],
        },
      },
    })
    expect(errors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("must have an @id field") })
    )
  })

  it('should error when table has multiple @id fields', () => {
    const errors = validateSchema({
      enums: {},
      tables: {
        User: {
          name: 'User',
          fields: [
            { name: 'id', type: 'number', optional: false, attributes: [{ name: 'id', args: [] }] },
            { name: 'uuid', type: 'string', optional: false, attributes: [{ name: 'id', args: [] }] },
          ],
          blockAttributes: [],
        },
      },
    })
    expect(errors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("2 @id fields") })
    )
  })

  // Rule 3: @default arguments must be valid
  it('should error on invalid @default function', () => {
    const errors = validateSchema({
      enums: {},
      tables: {
        User: {
          name: 'User',
          fields: [
            { name: 'id', type: 'number', optional: false, attributes: [{ name: 'id', args: [] }, { name: 'default', args: ['invalidfunc'] }] },
          ],
          blockAttributes: [],
        },
      },
    })
    expect(errors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("Invalid @default value 'invalidfunc'") })
    )
  })

  it('should accept valid @default functions', () => {
    const errors = validateSchema({
      enums: {},
      tables: {
        User: {
          name: 'User',
          fields: [
            { name: 'id', type: 'number', optional: false, attributes: [{ name: 'id', args: [] }, { name: 'default', args: ['autoincrement'] }] },
            { name: 'createdAt', type: 'datetime', optional: false, attributes: [{ name: 'default', args: ['now'] }] },
          ],
          blockAttributes: [],
        },
      },
    })
    expect(errors).toEqual([])
  })

  it('should accept @default with literal values', () => {
    const errors = validateSchema({
      enums: {},
      tables: {
        User: {
          name: 'User',
          fields: [
            { name: 'id', type: 'number', optional: false, attributes: [{ name: 'id', args: [] }] },
            { name: 'active', type: 'boolean', optional: false, attributes: [{ name: 'default', args: [true] }] },
            { name: 'score', type: 'number', optional: false, attributes: [{ name: 'default', args: [0] }] },
          ],
          blockAttributes: [],
        },
      },
    })
    expect(errors).toEqual([])
  })

  it('should accept @default with valid enum value', () => {
    const errors = validateSchema({
      enums: {
        Role: { name: 'Role', values: ['USER', 'ADMIN'] },
      },
      tables: {
        User: {
          name: 'User',
          fields: [
            { name: 'id', type: 'number', optional: false, attributes: [{ name: 'id', args: [] }] },
            { name: 'role', type: 'Role', optional: false, attributes: [{ name: 'default', args: ['USER'] }] },
          ],
          blockAttributes: [],
        },
      },
    })
    expect(errors).toEqual([])
  })

  it('should error on invalid enum default value', () => {
    const errors = validateSchema({
      enums: {
        Role: { name: 'Role', values: ['USER', 'ADMIN'] },
      },
      tables: {
        User: {
          name: 'User',
          fields: [
            { name: 'id', type: 'number', optional: false, attributes: [{ name: 'id', args: [] }] },
            { name: 'role', type: 'Role', optional: false, attributes: [{ name: 'default', args: ['SUPERADMIN'] }] },
          ],
          blockAttributes: [],
        },
      },
    })
    expect(errors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("Invalid @default value 'SUPERADMIN'") })
    )
  })

  // Rule 4: Enums must have at least one value
  it('should error on empty enum', () => {
    const errors = validateSchema({
      enums: {
        Empty: { name: 'Empty', values: [] },
      },
      tables: {},
    })
    expect(errors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("must have at least one value") })
    )
  })

  // Rule 5: No duplicate enum values
  it('should error on duplicate enum values', () => {
    const errors = validateSchema({
      enums: {
        Status: { name: 'Status', values: ['OPEN', 'DONE', 'OPEN'] },
      },
      tables: {},
    })
    expect(errors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("duplicate value 'OPEN'") })
    )
  })

  // Rule 6: Index/unique columns must reference existing fields
  it('should error when index references unknown field', () => {
    const errors = validateSchema({
      enums: {},
      tables: {
        User: {
          name: 'User',
          fields: [
            { name: 'id', type: 'number', optional: false, attributes: [{ name: 'id', args: [] }] },
            { name: 'name', type: 'string', optional: false, attributes: [] },
          ],
          blockAttributes: [
            { name: 'index', fields: ['nonexistent'] },
          ],
        },
      },
    })
    expect(errors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("unknown field 'nonexistent'") })
    )
  })

  it('should error when unique constraint references unknown field', () => {
    const errors = validateSchema({
      enums: {},
      tables: {
        User: {
          name: 'User',
          fields: [
            { name: 'id', type: 'number', optional: false, attributes: [{ name: 'id', args: [] }] },
          ],
          blockAttributes: [
            { name: 'unique', fields: ['email'] },
          ],
        },
      },
    })
    expect(errors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("unknown field 'email'") })
    )
  })

  it('should accept valid index and unique references', () => {
    const errors = validateSchema({
      enums: {},
      tables: {
        User: {
          name: 'User',
          fields: [
            { name: 'id', type: 'number', optional: false, attributes: [{ name: 'id', args: [] }] },
            { name: 'email', type: 'string', optional: false, attributes: [] },
            { name: 'name', type: 'string', optional: false, attributes: [] },
          ],
          blockAttributes: [
            { name: 'index', fields: ['email'] },
            { name: 'unique', fields: ['email', 'name'] },
          ],
        },
      },
    })
    expect(errors).toEqual([])
  })
})

// =============================================================================
// Identifier & String Validation (Issue #41)
// =============================================================================

describe('validateSchema identifier sanitization', () => {
  it('should error on invalid enum name', () => {
    const errors = validateSchema({
      enums: {
        'class': { name: 'class', values: ['A'] },
      },
      tables: {},
    })
    expect(errors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("Invalid enum name 'class'") })
    )
  })

  it('should error on enum name with special characters', () => {
    const errors = validateSchema({
      enums: {
        "bad'name": { name: "bad'name", values: ['A'] },
      },
      tables: {},
    })
    expect(errors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('Invalid enum name') })
    )
  })

  it('should error on enum value with control characters', () => {
    const errors = validateSchema({
      enums: {
        Status: { name: 'Status', values: ['OK', "BAD\x00VALUE"] },
      },
      tables: {},
    })
    expect(errors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('must not contain control characters') })
    )
  })

  it('should error on invalid table name', () => {
    const errors = validateSchema({
      enums: {},
      tables: {
        'function': {
          name: 'function',
          fields: [
            { name: 'id', type: 'number', optional: false, attributes: [{ name: 'id', args: [] }] },
          ],
          blockAttributes: [],
        },
      },
    })
    expect(errors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("Invalid table name 'function'") })
    )
  })

  it('should error on invalid field name', () => {
    const errors = validateSchema({
      enums: {},
      tables: {
        User: {
          name: 'User',
          fields: [
            { name: 'id', type: 'number', optional: false, attributes: [{ name: 'id', args: [] }] },
            { name: 'return', type: 'string', optional: false, attributes: [] },
          ],
          blockAttributes: [],
        },
      },
    })
    expect(errors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("Invalid field name 'return'") })
    )
  })

  it('should error on mapTo with control characters', () => {
    const errors = validateSchema({
      enums: {},
      tables: {
        User: {
          name: 'User',
          mapTo: "Sheet\x00Name",
          fields: [
            { name: 'id', type: 'number', optional: false, attributes: [{ name: 'id', args: [] }] },
          ],
          blockAttributes: [],
        },
      },
    })
    expect(errors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('must not contain control characters') })
    )
  })

  it('should accept valid identifiers and string values', () => {
    const errors = validateSchema({
      enums: {
        Role: { name: 'Role', values: ['USER', 'ADMIN'] },
      },
      tables: {
        User: {
          name: 'User',
          mapTo: 'Users Sheet',
          fields: [
            { name: 'id', type: 'number', optional: false, attributes: [{ name: 'id', args: [] }] },
            { name: 'role', type: 'Role', optional: false, attributes: [{ name: 'default', args: ['USER'] }] },
          ],
          blockAttributes: [],
        },
      },
    })
    expect(errors).toEqual([])
  })
})

describe('parseSchema with validation', () => {
  it('should include validation errors in parseSchema result', () => {
    const yaml = `
tables:
  User:
    fields:
      name: string
`
    const result = parseSchema(yaml)
    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("must have an @id field") })
    )
  })

  it('should report success false when validation fails', () => {
    const yaml = `
enums:
  Empty: []

tables:
  User:
    fields:
      id: number @id
      data: json
`
    const result = parseSchema(yaml)
    expect(result.success).toBe(false)
    expect(result.errors.length).toBeGreaterThanOrEqual(2)
  })
})

// =============================================================================
// @relation Attribute (Issue #76)
// =============================================================================

describe('@relation attribute parsing', () => {
  it('should parse @relation(User) attribute', () => {
    const field = parseField('assigneeId', 'string? @relation(User)')
    expect(field).toEqual({
      name: 'assigneeId',
      type: 'string',
      optional: true,
      attributes: [{ name: 'relation', args: ['User'] }],
    })
  })

  it('should parse @relation on string[] field', () => {
    const field = parseField('memberIds', 'string[] @relation(User)')
    expect(field).toEqual({
      name: 'memberIds',
      type: 'string[]',
      optional: false,
      attributes: [{ name: 'relation', args: ['User'] }],
    })
  })
})

describe('validateSchema @relation rules', () => {
  it('should accept valid @relation targeting a defined table', () => {
    const errors = validateSchema({
      enums: {},
      tables: {
        User: {
          name: 'User',
          fields: [
            { name: 'id', type: 'string', optional: false, attributes: [{ name: 'id', args: [] }] },
            { name: 'name', type: 'string', optional: false, attributes: [] },
          ],
          blockAttributes: [],
        },
        Task: {
          name: 'Task',
          fields: [
            { name: 'id', type: 'string', optional: false, attributes: [{ name: 'id', args: [] }] },
            { name: 'assigneeId', type: 'string', optional: true, attributes: [{ name: 'relation', args: ['User'] }] },
          ],
          blockAttributes: [],
        },
      },
    })
    expect(errors).toEqual([])
  })

  it('should error when @relation target is not a defined table', () => {
    const errors = validateSchema({
      enums: {},
      tables: {
        Task: {
          name: 'Task',
          fields: [
            { name: 'id', type: 'string', optional: false, attributes: [{ name: 'id', args: [] }] },
            { name: 'assigneeId', type: 'string', optional: true, attributes: [{ name: 'relation', args: ['NonExistent'] }] },
          ],
          blockAttributes: [],
        },
      },
    })
    expect(errors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("@relation target 'NonExistent'") })
    )
  })

  it('should error when @relation is used on non-string field', () => {
    const errors = validateSchema({
      enums: {},
      tables: {
        User: {
          name: 'User',
          fields: [
            { name: 'id', type: 'string', optional: false, attributes: [{ name: 'id', args: [] }] },
          ],
          blockAttributes: [],
        },
        Task: {
          name: 'Task',
          fields: [
            { name: 'id', type: 'string', optional: false, attributes: [{ name: 'id', args: [] }] },
            { name: 'assigneeId', type: 'number', optional: false, attributes: [{ name: 'relation', args: ['User'] }] },
          ],
          blockAttributes: [],
        },
      },
    })
    expect(errors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("only allowed on string-based fields") })
    )
  })

  it('should error when @relation has no target argument', () => {
    const errors = validateSchema({
      enums: {},
      tables: {
        Task: {
          name: 'Task',
          fields: [
            { name: 'id', type: 'string', optional: false, attributes: [{ name: 'id', args: [] }] },
            { name: 'assigneeId', type: 'string', optional: false, attributes: [{ name: 'relation', args: [] }] },
          ],
          blockAttributes: [],
        },
      },
    })
    expect(errors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("must specify a target table") })
    )
  })

  it('should accept @relation on string[] field', () => {
    const errors = validateSchema({
      enums: {},
      tables: {
        User: {
          name: 'User',
          fields: [
            { name: 'id', type: 'string', optional: false, attributes: [{ name: 'id', args: [] }] },
          ],
          blockAttributes: [],
        },
        Team: {
          name: 'Team',
          fields: [
            { name: 'id', type: 'string', optional: false, attributes: [{ name: 'id', args: [] }] },
            { name: 'memberIds', type: 'string[]', optional: false, attributes: [{ name: 'relation', args: ['User'] }] },
          ],
          blockAttributes: [],
        },
      },
    })
    expect(errors).toEqual([])
  })
})

describe('parseSchema with @relation', () => {
  it('should parse full schema with @relation', () => {
    const yaml = `
tables:
  User:
    fields:
      id: string @id
      name: string
  Task:
    fields:
      id: string @id
      title: string
      assigneeId: string? @relation(User)
`
    const result = parseSchema(yaml)
    expect(result.success).toBe(true)

    const assigneeField = result.schema?.tables.Task.fields.find(f => f.name === 'assigneeId')
    expect(assigneeField?.attributes).toContainEqual({ name: 'relation', args: ['User'] })
  })
})

// =============================================================================
// Integration Test with Example File
// =============================================================================

describe('Integration', () => {
  it('should parse the example schema file', async () => {
    // Read and parse the example file
    const fs = await import('fs')
    const path = await import('path')
    
    const examplePath = path.resolve(__dirname, '../../../../examples/schema.gsq.yaml')
    const content = fs.readFileSync(examplePath, 'utf-8')
    
    const result = parseSchema(content)
    
    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    
    // Check enums
    expect(result.schema?.enums.Role).toBeDefined()
    expect(result.schema?.enums.Role.values).toEqual(['USER', 'ADMIN', 'MODERATOR'])
    expect(result.schema?.enums.Priority).toBeDefined()
    expect(result.schema?.enums.Status).toBeDefined()
    
    // Check tables
    expect(result.schema?.tables.User).toBeDefined()
    expect(result.schema?.tables.Project).toBeDefined()
    expect(result.schema?.tables.Task).toBeDefined()
    expect(result.schema?.tables.Comment).toBeDefined()
    expect(result.schema?.tables.Label).toBeDefined()
    
    // Verify User table structure
    const user = result.schema?.tables.User
    expect(user?.fields.map(f => f.name)).toEqual([
      'id', 'email', 'name', 'nickname', 'role', 'active', 'loginCount', 'createdAt', 'updatedAt'
    ])
    
    // Verify Task table block attributes (3 indexes + 1 unique)
    const task = result.schema?.tables.Task
    expect(task?.blockAttributes.length).toBe(4)
    expect(task?.blockAttributes).toContainEqual({ name: 'index', fields: ['projectId'] })
    expect(task?.blockAttributes).toContainEqual({ name: 'index', fields: ['assigneeId'] })
    expect(task?.blockAttributes).toContainEqual({ name: 'index', fields: ['status'] })
    expect(task?.blockAttributes).toContainEqual({ name: 'unique', fields: ['projectId', 'title'] })
  })
})
