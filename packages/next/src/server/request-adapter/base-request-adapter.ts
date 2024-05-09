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
import { I18nPathnameNormalizer } from '../future/normalizers/request/i18n-route-normalizer'
import { addRequestMeta, type NextUrlWithParsedQuery } from '../request-meta'
import { parse, format } from 'node:url'

export class BaseRequestAdapter<ServerRequest extends BaseNextRequest>
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
        addRequestMeta(req, 'didStripLocale', true)
      }

      if (localeAnalysisResult.detectedLocale) {
        parsedURL.query.__nextLocale = localeAnalysisResult.detectedLocale
      }

      if (localeAnalysisResult.inferredFromDefault) {
        parsedURL.query.__nextInferredLocaleFromDefault = '1'
      }
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
