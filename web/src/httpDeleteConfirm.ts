export function requestDeleteWarning(name: string): string {
  return `Delete request “${name}”? This cannot be undone.`
}

export function collectionDeletePrompt(name: string): string {
  return `This permanently deletes the collection and every request in it. Type “${name}” to confirm.`
}

export function confirmedHTTPCollectionDelete(name: string, typed: string | null): boolean {
  return (typed ?? '').trim() === name
}
