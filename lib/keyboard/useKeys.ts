'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { keys, type Binding, type Scope } from './registry'

/** Registers bindings for the lifetime of a component. */
export function useBindings(bindings: Binding[], deps: readonly unknown[] = []) {
  useEffect(() => {
    return keys().registerMany(bindings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/** Marks a scope active while a component is mounted or focused. */
export function useScope(scope: Scope, active = true) {
  useEffect(() => {
    if (!active) return
    return keys().pushScope(scope)
  }, [scope, active])
}

export function useBindingList(): Binding[] {
  return useSyncExternalStore(
    (cb) => keys().subscribe(cb),
    () => keys().list(),
    () => EMPTY,
  )
}

const EMPTY: Binding[] = []
