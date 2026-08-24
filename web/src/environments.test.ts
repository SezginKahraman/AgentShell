import { describe, expect, it } from 'vitest'
import { emptyEnvironmentLibrary, envTone, setLibraryValue, stackEnvironmentLabel } from './environments'
import type { Stack } from './types'

describe('envTone', () => {
  it('maps known names and treats unknowns as custom', () => {
    expect(envTone('local')).toBe('local')
    expect(envTone('prod')).toBe('prod')
    expect(envTone('stage')).toBe('stage')
    expect(envTone('test')).toBe('test')
    expect(envTone('qa')).toBe('test')
    expect(envTone('custom')).toBe('custom')
    expect(envTone('preview')).toBe('custom')
  })
})

describe('stackEnvironmentLabel', () => {
  it('prefers resolved_environment then environment then local', () => {
    expect(stackEnvironmentLabel({} as Stack)).toBe('local')
    expect(stackEnvironmentLabel({ environment: 'prod' } as Stack)).toBe('prod')
    expect(stackEnvironmentLabel({ environment: 'prod', resolved_environment: 'custom' } as Stack)).toBe('custom')
  })

  it('seeds an empty library with local', () => {
    expect(emptyEnvironmentLibrary()).toEqual({ names: ['local', 'prod', 'stage', 'test'], keys: [], values: {} })
  })
})

describe('setLibraryValue', () => {
  it('adds a key and cell for the named profile', () => {
    const next = setLibraryValue(emptyEnvironmentLibrary(), 'META_URL', 'local', 'http://127.0.0.1:8091')
    expect(next.keys).toEqual(['META_URL'])
    expect(next.values).toEqual({ META_URL: { local: 'http://127.0.0.1:8091' } })
  })

  it('fills a missing profile without dropping other cells', () => {
    const start = setLibraryValue(emptyEnvironmentLibrary(), 'META_URL', 'prod', 'https://www.enuygun.com')
    const next = setLibraryValue(start, 'META_URL', 'local', 'http://127.0.0.1:8091')
    expect(next.keys).toEqual(['META_URL'])
    expect(next.values?.META_URL).toEqual({ prod: 'https://www.enuygun.com', local: 'http://127.0.0.1:8091' })
  })
})
