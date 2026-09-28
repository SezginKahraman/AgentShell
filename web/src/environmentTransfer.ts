import type { EnvironmentLibrary } from './types'

export const environmentLibraryKind = 'agentshell.environment_library'

export function redactEnvironmentLibrary(library: EnvironmentLibrary): EnvironmentLibrary {
  const secrets = new Set(library.secret_keys ?? [])
  const values: Record<string, Record<string, string>> = {}
  for (const [key, row] of Object.entries(library.values ?? {})) {
    const next: Record<string, string> = {}
    for (const [name, value] of Object.entries(row ?? {})) {
      next[name] = secrets.has(key) && value !== '' ? '***' : value
    }
    if (Object.keys(next).length) values[key] = next
  }
  return { names: [...library.names], keys: [...library.keys], secret_keys: [...(library.secret_keys ?? [])], values }
}

export function environmentLibraryDocument(library: EnvironmentLibrary, revealSecrets: boolean) {
  const source = revealSecrets ? library : redactEnvironmentLibrary(library)
  return {
    kind: environmentLibraryKind,
    names: source.names,
    keys: source.keys,
    secret_keys: source.secret_keys ?? [],
    values: source.values ?? {},
  }
}

export function environmentLibraryJSON(library: EnvironmentLibrary, revealSecrets = true) {
  return JSON.stringify(environmentLibraryDocument(library, revealSecrets), null, 2)
}

export function parseEnvironmentLibraryImport(raw: unknown): EnvironmentLibrary {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('environment file must be a JSON object')
  const doc = raw as Record<string, unknown>
  if (doc.kind != null && doc.kind !== environmentLibraryKind) throw new Error('unsupported settings file')
  if (!Array.isArray(doc.names) || doc.names.some(item => typeof item !== 'string')) throw new Error('names must be a list of strings')
  if (!Array.isArray(doc.keys) || doc.keys.some(item => typeof item !== 'string')) throw new Error('keys must be a list of strings')
  const secret_keys = doc.secret_keys == null ? [] : doc.secret_keys
  if (!Array.isArray(secret_keys) || secret_keys.some(item => typeof item !== 'string')) throw new Error('secret_keys must be a list of strings')
  const values = doc.values == null ? {} : doc.values
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('values must be an object')
  const parsed: Record<string, Record<string, string>> = {}
  for (const [key, row] of Object.entries(values as Record<string, unknown>)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`values.${key} must be an object`)
    const next: Record<string, string> = {}
    for (const [name, value] of Object.entries(row as Record<string, unknown>)) {
      if (typeof value !== 'string') throw new Error(`values.${key}.${name} must be a string`)
      next[name] = value
    }
    parsed[key] = next
  }
  return { names: doc.names as string[], keys: doc.keys as string[], secret_keys: secret_keys as string[], values: parsed }
}

export function downloadEnvironmentLibrary(library: EnvironmentLibrary, revealSecrets: boolean) {
  const blob = new Blob([environmentLibraryJSON(library, revealSecrets)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = revealSecrets ? 'agentshell-environments.json' : 'agentshell-environments-redacted.json'
  link.click()
  URL.revokeObjectURL(url)
}
