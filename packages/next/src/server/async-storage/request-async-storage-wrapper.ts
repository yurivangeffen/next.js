import type { BaseNextRequest, BaseNextResponse } from '../base-http'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'http'
import type { AsyncLocalStorage } from 'async_hooks'
import type { RequestStore } from '../../client/components/request-async-storage.external'
import type { RenderOpts } from '../app-render/types'
import type { AsyncStorageWrapper } from './async-storage-wrapper'
import type { NextRequest } from '../web/spec-extension/request'
import type { __ApiPreviewProps } from '../api-utils'

import { FLIGHT_PARAMETERS } from '../../client/components/app-router-headers'
import {
  HeadersAdapter,
  type ReadonlyHeaders,
} from '../web/spec-extension/adapters/headers'
import {
  MutableRequestCookiesAdapter,
  RequestCookiesAdapter,
  type ReadonlyRequestCookies,
} from '../web/spec-extension/adapters/request-cookies'
import type { ResponseCookies } from '../web/spec-extension/cookies'
import { RequestCookies } from '../web/spec-extension/cookies'
import { DraftModeProvider } from './draft-mode-provider'

function getHeaders(headers: Headers | IncomingHttpHeaders): ReadonlyHeaders {
  const cleaned = HeadersAdapter.from(headers)
  for (const param of FLIGHT_PARAMETERS) {
    cleaned.delete(param.toString().toLowerCase())
  }

  return HeadersAdapter.seal(cleaned)
}

export type RequestContext = {
  req: IncomingMessage | BaseNextRequest | NextRequest
  res?: ServerResponse | BaseNextResponse
  renderOpts?: RenderOpts
}

/**
 * Parse the cookies from the incoming source, including those that were set in
 * middleware.
 */
function parseCookies(source: IncomingHttpHeaders | Headers): RequestCookies {
  source = HeadersAdapter.from(source)

  const headers: Headers = new Headers()
  if (typeof source.get('cookie') === 'string') {
    headers.append('cookie', source.get('cookie') as string)
  }
  if (typeof source.get('x-middleware-set-cookie') === 'string') {
    headers.append('cookie', headers.get('x-middleware-set-cookie') as string)
  }

  return new RequestCookies(headers)
}

export const RequestAsyncStorageWrapper: AsyncStorageWrapper<
  RequestStore,
  RequestContext
> = {
  /**
   * Wrap the callback with the given store so it can access the underlying
   * store using hooks.
   *
   * @param storage underlying storage object returned by the module
   * @param context context to seed the store
   * @param callback function to call within the scope of the context
   * @returns the result returned by the callback
   */
  wrap<Result>(
    storage: AsyncLocalStorage<RequestStore>,
    { req, res, renderOpts }: RequestContext,
    callback: (store: RequestStore) => Result
  ): Result {
    let previewProps: __ApiPreviewProps | undefined = undefined

    if (renderOpts && 'previewProps' in renderOpts) {
      // TODO: investigate why previewProps isn't on RenderOpts
      previewProps = (renderOpts as any).previewProps
    }

    const cache: {
      cookies: {
        /**
         * The cookies that represent the source for the render. Any
         * modifications made to the mutable response cookies will also be
         * mirrored onto this property.
         */
        source?: RequestCookies
        readonly?: ReadonlyRequestCookies
        mutable?: ResponseCookies
      }
      headers?: ReadonlyHeaders
      draftMode?: DraftModeProvider
    } = { cookies: {} }

    const store: RequestStore = {
      get headers() {
        if (!cache.headers) {
          // Seal the headers object that'll freeze out any methods that could
          // mutate the underlying data.
          cache.headers = getHeaders(req.headers)
        }

        return cache.headers
      },
      get cookies() {
        // Ensure that the source cookies is populated.
        if (!cache.cookies.source) {
          cache.cookies.source = parseCookies(req.headers)
        }

        // Ensure that the immutable cookies is populated and sealed.
        if (!cache.cookies.readonly) {
          cache.cookies.readonly = RequestCookiesAdapter.seal(
            cache.cookies.source
          )
        }

        return cache.cookies.readonly
      },
      get mutableCookies() {
        // Ensure that the source cookies is populated.
        if (!cache.cookies.source) {
          cache.cookies.source = parseCookies(req.headers)
        }

        // Ensure that the mutable cookies is populated.
        if (!cache.cookies.mutable) {
          cache.cookies.mutable = MutableRequestCookiesAdapter.wrap(
            cache.cookies.source,
            (cookies) => {
              if (renderOpts?.onUpdateCookies) {
                return renderOpts.onUpdateCookies(cookies)
              }

              // Update the response if we have one.
              if (res) {
                res.setHeader('Set-Cookie', cookies)
              }
            }
          )
        }

        return cache.cookies.mutable
      },
      get draftMode() {
        if (!cache.draftMode) {
          cache.draftMode = new DraftModeProvider(
            previewProps,
            req,
            this.cookies,
            this.mutableCookies
          )
        }

        return cache.draftMode
      },
      reactLoadableManifest: renderOpts?.reactLoadableManifest || {},
      assetPrefix: renderOpts?.assetPrefix || '',
    }

    return storage.run(store, callback, store)
  },
}
