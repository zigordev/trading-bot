import { getRPCMetadata, RPCType } from '@opentelemetry/core';
import { ATTR_HTTP_ROUTE } from '@opentelemetry/semantic-conventions';

import type { Context } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base';

const ROUTER_TYPE_ATTRIBUTE = 'router.type';
const REQUEST_HANDLER = 'request_handler';

export class RouteNameProcessor implements SpanProcessor {
  onStart(span: Span, parentContext: Context): void {
    if (span.attributes[ROUTER_TYPE_ATTRIBUTE] !== REQUEST_HANDLER) return;

    const route = span.attributes[ATTR_HTTP_ROUTE];
    if (typeof route !== 'string' || route.length === 0) return;

    const rpcMetadata = getRPCMetadata(parentContext);
    if (rpcMetadata?.type !== RPCType.HTTP) return;

    rpcMetadata.route = route;
  }

  onEnd(_span: ReadableSpan): void {}

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}
