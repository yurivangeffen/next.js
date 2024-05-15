export type WaitUntil = (promise: Promise<any>) => void

export function getBuiltinWaitUntil(): WaitUntil | undefined {
  const _globalThis = globalThis as GlobalThisWithRequestContext
  const ctx = _globalThis[INTERNAL_REQUEST_CONTEXT_SYMBOL]
  return ctx?.get()?.waitUntil
}

const INTERNAL_REQUEST_CONTEXT_SYMBOL = Symbol.for('@vercel/request-context')

type GlobalThisWithRequestContext = typeof globalThis & {
  [INTERNAL_REQUEST_CONTEXT_SYMBOL]?: RequestContext
}

type RequestContext = {
  get(): { waitUntil: WaitUntil } | undefined
}
