import { describe, expect, it } from 'vitest'
import { emptyEnvironmentLibrary, envTone, stackEnvironmentLabel } from './environments'
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
