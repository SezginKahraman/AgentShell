export function formatHTTPBody(body: string): string {
  return beautifyJSON(body) ?? body
}

export function beautifyHTTPBody(body: string): string {
  const trimmed = body.trim()
  if (!trimmed) return body
  return beautifyJSON(body) ?? beautifyXML(trimmed) ?? body
}

function beautifyJSON(body: string): string | undefined {
  const trimmed = body.trim()
  if (!trimmed) return undefined
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return undefined
  }
}

function beautifyXML(trimmed: string): string | undefined {
  if (typeof DOMParser === 'undefined') return undefined
  if (!/^<\?xml\b/i.test(trimmed) && !/^<[A-Za-z_:]/.test(trimmed)) return undefined
  const doc = new DOMParser().parseFromString(trimmed, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return undefined
  const root = doc.documentElement
  if (!root || root.nodeName === 'parsererror') return undefined
  const pretty = serializeElement(root, '').replace(/\n$/, '')
  const declaration = trimmed.match(/^<\?xml\b[^?]*\?>/i)
  return declaration ? `${declaration[0]}\n${pretty}` : pretty
}

function serializeElement(el: Element, indent: string): string {
  const attrs = Array.from(el.attributes).map(attr => ` ${attr.name}="${escapeAttr(attr.value)}"`).join('')
  const children = Array.from(el.childNodes).filter(node => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').trim().length > 0
    return node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.COMMENT_NODE
  })
  if (!children.length) return `${indent}<${el.nodeName}${attrs}/>\n`
  if (children.length === 1 && children[0].nodeType === Node.TEXT_NODE) {
    return `${indent}<${el.nodeName}${attrs}>${escapeText((children[0].textContent ?? '').trim())}</${el.nodeName}>\n`
  }
  let inner = ''
  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE) inner += serializeElement(child as Element, `${indent}  `)
    else if (child.nodeType === Node.COMMENT_NODE) inner += `${indent}  <!--${child.textContent ?? ''}-->\n`
    else inner += `${indent}  ${escapeText((child.textContent ?? '').trim())}\n`
  }
  return `${indent}<${el.nodeName}${attrs}>\n${inner}${indent}</${el.nodeName}>\n`
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;')
}
