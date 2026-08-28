'use client'

/**
 * Keyboard is a data structure, not scattered handlers.
 *
 * Every binding is registered with a scope. The dispatcher resolves the active
 * scope from focus, so `d` means dispatch in the incident feed and does nothing
 * in a text field. The `?` overlay and the tooltips are generated from this
 * registry, which is the only way the hints stay true as screens are added.
 */

export type Scope = 'global' | 'feed' | 'map' | 'stage' | 'timeline' | 'table' | 'search'

export interface Binding {
  id: string
  scope: Scope
  keys: string
  label: string
  group: string
  run: (event: KeyboardEvent) => void
  /** Bindings that should still fire while a text field has focus. */
  allowInInput?: boolean
}

type Listener = () => void

class KeyRegistry {
  private bindings = new Map<string, Binding>()
  private activeScopes = new Set<Scope>(['global'])
  private listeners = new Set<Listener>()
  /* Cached because useSyncExternalStore compares snapshots by identity: a fresh
     array on every read is an infinite render loop, not a re-render. */
  private snapshot: Binding[] = []

  register(binding: Binding): () => void {
    this.bindings.set(binding.id, binding)
    this.emit()
    return () => {
      this.bindings.delete(binding.id)
      this.emit()
    }
  }

  registerMany(bindings: Binding[]): () => void {
    const unsubs = bindings.map((b) => this.register(b))
    return () => unsubs.forEach((u) => u())
  }

  pushScope(scope: Scope): () => void {
    this.activeScopes.add(scope)
    this.emit()
    return () => {
      this.activeScopes.delete(scope)
      this.emit()
    }
  }

  list(): Binding[] {
    return this.snapshot
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    this.snapshot = [...this.bindings.values()]
      .filter((b) => this.activeScopes.has(b.scope))
      .sort((a, b) => a.group.localeCompare(b.group) || a.keys.localeCompare(b.keys))
    for (const fn of this.listeners) fn()
  }

  handle(event: KeyboardEvent): boolean {
    const target = event.target
    const inInput =
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

    const combo = comboOf(event)
    for (const binding of this.bindings.values()) {
      if (!this.activeScopes.has(binding.scope)) continue
      if (inInput && !binding.allowInInput) continue
      if (!binding.keys.split(' or ').includes(combo)) continue
      event.preventDefault()
      binding.run(event)
      return true
    }
    return false
  }
}

export function comboOf(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('mod')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey && event.key.length > 1) parts.push('shift')
  const key = event.key === ' ' ? 'space' : event.key
  parts.push(key.length === 1 ? key : key.toLowerCase())
  return parts.join('+')
}

const KEY = '__civicsense_keys__'

interface GlobalWithKeys {
  [KEY]?: KeyRegistry
}

export function keys(): KeyRegistry {
  const g = globalThis as GlobalWithKeys
  if (!g[KEY]) g[KEY] = new KeyRegistry()
  return g[KEY]
}
