/**
 * SseStreamProtocol - Declarative SSE stream descriptors
 *
 * Owns the descriptor contract for SSE streams while delegating imperative
 * connection lifecycle work to an injected SseProtocol instance.
 */

import {
  ApiProtocol,
  type ApiServiceConfig,
  type BasePluginHooks,
  type PluginClass,
  type StreamDescriptor,
} from '../types';
import { SseProtocol } from './SseProtocol';

/**
 * Declarative SSE descriptor contract.
 *
 * This contract is separate from SseProtocol's imperative connect/disconnect
 * API so services can opt into a descriptor-driven streaming model explicitly.
 */
// @cpt-algo:cpt-frontx-algo-api-protocol-surface-descriptor-derivation:p1
export class SseStreamProtocol extends ApiProtocol<BasePluginHooks> {
  private config: Readonly<ApiServiceConfig> | null = null;

  constructor(private readonly sse: SseProtocol) {
    super();
  }

  initialize(
    config: Readonly<ApiServiceConfig>,
    _getExcludedClasses?: () => ReadonlySet<PluginClass>
  ): void {
    this.config = config;
  }

  getPluginsInOrder(): readonly BasePluginHooks[] {
    return [];
  }

  cleanup(): void {
    this.config = null;
  }

  stream<TEvent>(
    path: string,
    options?: { parse?: (event: MessageEvent) => TEvent }
  ): StreamDescriptor<TEvent> {
    const config = this.getConfig();
    // @cpt-begin:cpt-frontx-algo-api-protocol-surface-descriptor-derivation:p1:inst-derive-endpoint-key
    const key = [config.baseURL, 'SSE', path] as const;
    const parse = options?.parse ?? ((event: MessageEvent) => JSON.parse(event.data) as TEvent);
    // @cpt-end:cpt-frontx-algo-api-protocol-surface-descriptor-derivation:p1:inst-derive-endpoint-key

    // @cpt-begin:cpt-frontx-algo-api-protocol-surface-descriptor-derivation:p1:inst-build-stream-descriptor
    return {
      key,
      connect: (onEvent, onComplete) =>
        this.sse.connect(
          path,
          (event: MessageEvent) => onEvent(parse(event)),
          onComplete
        ),
      disconnect: (connectionId) => {
        this.sse.disconnect(connectionId);
      },
    };
    // @cpt-end:cpt-frontx-algo-api-protocol-surface-descriptor-derivation:p1:inst-build-stream-descriptor
  }

  private getConfig(): Readonly<ApiServiceConfig> {
    // @cpt-begin:cpt-frontx-algo-api-protocol-surface-descriptor-derivation:p1:inst-guard-config
    if (!this.config) {
      throw new Error('SseStreamProtocol not initialized. Call initialize() first.');
    }

    return this.config;
    // @cpt-end:cpt-frontx-algo-api-protocol-surface-descriptor-derivation:p1:inst-guard-config
  }
}
