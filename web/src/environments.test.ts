import { describe, expect, it } from 'vitest'
import { emptyEnvironmentLibrary, stackEnvironmentLabel } from './environments'
import type { Stack } from './types'

describe('stackEnvironmentLabel', () => {
  it('prefers resolved_environment then environment then local', () => {
    expect(stackEnvironmentLabel({} as Stack)).toBe('local')
    expect(stackEnvironmentLabel({ environment: 'prod' } as Stack)).toBe('prod')
    expect(stackEnvironmentLabel({ environment: 'prod', resolved_environment: 'custom' } as Stack)).toBe('custom')
  })

  it('seeds an empty library with local', () => {
    expect(emptyEnvironmentLibrary()).toEqual({ names: ['local'], keys: [], values: {} })
  })
})
