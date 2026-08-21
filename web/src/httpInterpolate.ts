export const interpolateTemplate = (template: string, vars: Record<string, string>): string => {
  const missing: string[] = []
  const seen = new Set<string>()
  const out = template.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_match, key: string) => {
    if (!(key in vars)) {
      if (!seen.has(key)) {
        seen.add(key)
        missing.push(key)
      }
      return _match
    }
    return vars[key]
  })
  if (missing.length) throw new Error(`unresolved placeholders: ${missing.join(', ')}`)
  if (out.includes('{{')) throw new Error('invalid placeholder syntax')
  return out
}

export const httpCollectionVars = (library: { names?: string[]; values?: Record<string, Record<string, string>> }, collection: { environment?: string; stack_id?: string }, stack?: { environment?: string; env?: Record<string, Record<string, string>> }): { name: string; vars: Record<string, string> } => {
  const names = library.names ?? ['local']
  const name = stack?.environment || collection.environment || (names.includes('local') ? 'local' : names[0] || 'local')
  const vars: Record<string, string> = {}
  for (const [key, byEnv] of Object.entries(library.values ?? {})) {
    if (byEnv?.[name] !== undefined) vars[key] = byEnv[name]
  }
  if (stack?.env) {
    for (const [key, byEnv] of Object.entries(stack.env)) {
      if (byEnv?.[name] !== undefined) vars[key] = byEnv[name]
    }
  }
  return { name, vars }
}
