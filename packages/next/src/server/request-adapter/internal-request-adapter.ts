import type { BaseNextRequest } from '../base-http'
import type { RequestAdapter } from './request-adapter'
import type { NextConfigComplete } from '../config-shared'
import type { I18NProvider } from '../future/helpers/i18n-provider'
import type { NextEnabledDirectories } from '../base-server'

import { parse, format } from 'node:url'
import { BasePathPathnameNormalizer } from '../future/normalizers/request/base-path'
import { addRequestMeta, type NextUrlWithParsedQuery } from '../request-meta'
import querystring from 'node:querystring'
import {
  NEXT_ROUTER_PREFETCH_HEADER,
  RSC_HEADER,
} from '../../client/components/app-router-headers'
import { I18nPathnameNormalizer } from '../future/normalizers/request/i18n-route-normalizer'
import { getHostname } from '../../shared/lib/get-hostname'

export class InvokeError {
  constructor(
    public readonly statusCode: number,
    public readonly cause: Error | null
  ) {}
}

export class InternalRequestAdapter<ServerRequest extends BaseNextRequest>
  implements RequestAdapter<ServerRequest>
{
  private readonly normalizers: {
    readonly basePath: BasePathPathnameNormalizer | undefined
    readonly i18n: I18nPathnameNormalizer | undefined
  }

  constructor(
    private readonly enabledDirectories: NextEnabledDirectories,
    private readonly i18nProvider: I18NProvider | undefined,
    private readonly nextConfig: NextConfigComplete
  ) {
    this.normalizers = {
      basePath: this.nextConfig.basePath
        ? new BasePathPathnameNormalizer(this.nextConfig.basePath)
        : undefined,
      i18n: i18nProvider ? new I18nPathnameNormalizer(i18nProvider) : undefined,
    }
  }

  public async adapt(req: ServerRequest, parsedURL: NextUrlWithParsedQuery) {
    const invokePath = req.headers['x-invoke-path']

    // If there's no path to invoke, do nothing.
    if (!invokePath || typeof invokePath !== 'string') return

    // Strip any internal query parameters from the query object that aren't
    // associated with internal Next.js
    for (const key of Object.keys(parsedURL.query)) {
      if (!key.startsWith('__next') && !key.startsWith('_next')) {
        delete parsedURL.query[key]
      }
    }

    // Apply the query parameters from the x-invoke-query header.
    const query = req.headers['x-invoke-query']
    if (typeof query === 'string') {
      Object.assign(
        parsedURL.query,
        querystring.parse(decodeURIComponent(query))
      )
    }

    // If a status is provided, assume that it's an error.
    if (typeof req.headers['x-invoke-status'] === 'string') {
      const statusCode = Number(req.headers['x-invoke-status'])

      let cause: Error | null = null
      if (typeof req.headers['x-invoke-error'] === 'string') {
        cause = new Error(req.headers['x-invoke-error'])
      }

      throw new InvokeError(statusCode, cause)
    }

    // Save a copy of the original unmodified pathname so we can see if we
    // rewrote it.
    const originalPathname = parsedURL.pathname

    // If it differs from the invoke path, rewrite the pathname.
    if (parsedURL.pathname !== invokePath) {
      parsedURL.pathname = invokePath
    }

    // Remove the base path from the pathname.
    if (this.normalizers.basePath) {
      parsedURL.pathname = this.normalizers.basePath.normalize(
        parsedURL.pathname
      )
    }

    // Remove the locale prefix from the pathname.
    if (this.i18nProvider) {
      const hostname = getHostname(parsedURL, req.headers)
      const domainLocale = this.i18nProvider.detectDomainLocale(hostname)
      const defaultLocale =
        domainLocale?.defaultLocale ?? this.i18nProvider?.config.defaultLocale

      // Perform locale detection and normalization.
      const localeAnalysisResult = this.i18nProvider.analyze(
        parsedURL.pathname,
        { defaultLocale }
      )

      if (parsedURL.pathname !== localeAnalysisResult.pathname) {
        parsedURL.pathname = localeAnalysisResult.pathname
        addRequestMeta(req, 'didStripLocale', true)
      }

      if (localeAnalysisResult.detectedLocale) {
        parsedURL.query.__nextLocale = localeAnalysisResult.detectedLocale
      }

      if (localeAnalysisResult.inferredFromDefault) {
        parsedURL.query.__nextInferredLocaleFromDefault = '1'
      }
    }

    // If we did we rewrite the URL, add a metadata entry.
    if (originalPathname !== parsedURL.pathname) {
      addRequestMeta(req, 'rewroteURL', parsedURL.pathname)
    }

    if (this.enabledDirectories.app) {
      if (req.headers[RSC_HEADER.toLowerCase()] === '1') {
        addRequestMeta(req, 'isRSCRequest', true)
      }

      if (req.headers[NEXT_ROUTER_PREFETCH_HEADER.toLowerCase()] === '1') {
        addRequestMeta(req, 'isPrefetchRSCRequest', true)
      }
    }

    // Update the URL with the new pathname.
    req.url = format({
      ...parse(req.url),
      pathname: parsedURL.pathname,
    })
  }
}
