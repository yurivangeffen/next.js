import type { RequestAdapter } from './request-adapter'
import type { BaseNextRequest } from '../base-http'
import type { NextEnabledDirectories } from '../base-server'
import type { NextConfigComplete } from '../config-shared'
import type { I18NProvider } from '../future/helpers/i18n-provider'

import {
  RSC_HEADER,
  NEXT_ROUTER_PREFETCH_HEADER,
} from '../../client/components/app-router-headers'
import { getHostname } from '../../shared/lib/get-hostname'
import { BasePathPathnameNormalizer } from '../future/normalizers/request/base-path'
import { addRequestMeta, type NextUrlWithParsedQuery } from '../request-meta'
import { format } from 'url'
import { parseUrl } from '../../shared/lib/router/utils/parse-url'

export class BaseRequestAdapter<ServerRequest extends BaseNextRequest>
  implements RequestAdapter<ServerRequest>
{
  protected readonly normalizers: {
    readonly basePath: BasePathPathnameNormalizer | undefined
  }

  constructor(
    protected readonly enabledDirectories: NextEnabledDirectories,
    protected readonly i18nProvider: I18NProvider | undefined,
    protected readonly nextConfig: NextConfigComplete
  ) {
    this.normalizers = {
      basePath: this.nextConfig.basePath
        ? new BasePathPathnameNormalizer(this.nextConfig.basePath)
        : undefined,
    }
  }

  protected adaptRequest(
    req: ServerRequest,
    parsedURL: NextUrlWithParsedQuery
  ) {
    if (!parsedURL.pathname) {
      throw new Error('Invariant: pathname must be set')
    }

    // Analyze the URL for locale information. If we modify it, we should
    // reconstruct it.
    let url = parseUrl(req.url)

    let modified = false
    if (this.normalizers.basePath) {
      const pathname = this.normalizers.basePath.normalize(url.pathname)
      if (pathname !== url.pathname) {
        url.pathname = pathname
        modified = true
      }
    }

    if (this.i18nProvider) {
      const { pathname } = this.i18nProvider.analyze(url.pathname)
      if (pathname !== url.pathname) {
        url.pathname = pathname
        addRequestMeta(req, 'didStripLocale', true)
        modified = true
      }
    }

    if (modified) {
      req.url = format(url)
    }

    this.attachRSCRequestMetadata(req, parsedURL)
  }

  protected attachRSCRequestMetadata(
    req: ServerRequest,
    parsedURL: NextUrlWithParsedQuery
  ): void {
    if (!this.enabledDirectories.app) return

    if (req.headers[RSC_HEADER.toLowerCase()] === '1') {
      // If we're here, this is a data request, as it didn't return and it matched
      // either a RSC or a prefetch RSC request.
      parsedURL.query.__nextDataReq = '1'

      addRequestMeta(req, 'isRSCRequest', true)

      if (req.headers[NEXT_ROUTER_PREFETCH_HEADER.toLowerCase()] === '1') {
        addRequestMeta(req, 'isPrefetchRSCRequest', true)
      }
    }
  }

  public async adapt(req: ServerRequest, parsedURL: NextUrlWithParsedQuery) {
    this.adaptRequest(req, parsedURL)

    if (!parsedURL.pathname) {
      throw new Error('Invariant: pathname must be set')
    }

    if (this.normalizers.basePath) {
      parsedURL.pathname = this.normalizers.basePath.normalize(
        parsedURL.pathname
      )
    }

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
      }

      if (localeAnalysisResult.detectedLocale) {
        parsedURL.query.__nextLocale = localeAnalysisResult.detectedLocale
      }

      if (localeAnalysisResult.inferredFromDefault) {
        parsedURL.query.__nextInferredLocaleFromDefault = '1'
      }
    }
  }
}
