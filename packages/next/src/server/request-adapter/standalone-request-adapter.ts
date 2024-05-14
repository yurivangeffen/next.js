import type { BaseNextRequest } from '../base-http'
import type { NextUrlWithParsedQuery } from '../request-meta'
import type { RequestAdapter } from './request-adapter'
import type { XInvokePathRequestAdapter } from './x-invoke-path-request-adapter'
import type { XMatchedPathRequestAdapter } from './x-matched-path-request-adapter'

export class StandaloneRequestAdapter<ServerRequest extends BaseNextRequest>
  implements RequestAdapter<ServerRequest>
{
  constructor(
    private readonly xMatchedPathRequestAdapter: XMatchedPathRequestAdapter<ServerRequest>,
    private readonly xInvokePathRequestAdapter: XInvokePathRequestAdapter<ServerRequest>
  ) {}

  public async adapt(
    req: ServerRequest,
    parsedURL: NextUrlWithParsedQuery
  ): Promise<void> {
    // Today, standalone mode is used to test the x-matched-path support as
    // well.

    // FIXME: remove this fallback when the tests are updated.
    if (
      req.headers['x-matched-path'] &&
      typeof req.headers['x-matched-path'] === 'string'
    ) {
      return this.xMatchedPathRequestAdapter.adapt(req, parsedURL)
    }

    return this.xInvokePathRequestAdapter.adapt(req, parsedURL)
  }
}
