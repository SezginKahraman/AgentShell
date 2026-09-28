import { describe, expect, it } from 'vitest'
import { environmentLibraryJSON, parseEnvironmentLibraryImport, redactEnvironmentLibrary } from './environmentTransfer'
import type { EnvironmentLibrary } from './types'

const library: EnvironmentLibrary = {
  names: ['local', 'prod'],
  keys: ['API_URL', 'EXPEDIA_API_KEY'],
  secret_keys: ['EXPEDIA_API_KEY'],
  values: {
    API_URL: { local: 'http://127.0.0.1:8080' },
    EXPEDIA_API_KEY: { prod: 'secret-value', local: '' },
  },
}

describe('environment library transfer', () => {
  it('hides non-empty secret cells and keeps ordinary values', () => {
    const redacted = redactEnvironmentLibrary(library)
    expect(redacted.values?.EXPEDIA_API_KEY?.prod).toBe('***')
    expect(redacted.values?.EXPEDIA_API_KEY?.local).toBe('')
    expect(redacted.values?.API_URL?.local).toBe('http://127.0.0.1:8080')
    expect(environmentLibraryJSON(library, false)).toContain('"prod": "***"')
    expect(environmentLibraryJSON(library, true)).toContain('secret-value')
  })

  it('reads an export and rejects a different file kind', () => {
    const parsed = parseEnvironmentLibraryImport(JSON.parse(environmentLibraryJSON(library, false)))
    expect(parsed.secret_keys).toEqual(['EXPEDIA_API_KEY'])
    expect(parsed.values?.EXPEDIA_API_KEY?.prod).toBe('***')
    expect(() => parseEnvironmentLibraryImport({ kind: 'agentshell.http_collection', names: [], keys: [] })).toThrow(/unsupported/)
  })
})
