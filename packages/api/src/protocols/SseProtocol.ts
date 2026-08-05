/**
 * SSE Protocol
 * Handles Server-Sent Events communication using EventSource API
 */

// @cpt-flow:cpt-frontx-flow-api-protocol-surface-service-call:p1
// @cpt-dod:cpt-frontx-dod-api-protocol-surface-protocol-dispatch:p1

import assign from 'lodash/assign.js';
import {
  ApiProtocol,
  type ApiServiceConfig,
  type SseProtocolConfig,
  type SsePluginHooks,
  type SseConnectContext,
  type EventSourceLike,
  type PluginClass,
} from '../types';
import { isSseShortCircuit } from '../types';
import { protocolPluginRegistry } from '../protocolPluginRegistry';

/**
 * SSE Protocol Implementation
 * Manages Server-Sent Events connections using EventSource API
 */
export class SseProtocol extends ApiProtocol<SsePluginHooks> {
  private baseConfig!: Readonly<ApiServiceConfig>;
  private connections: Map<string, EventSource> = new Map();
  private readonly config: SseProtocolConfig;
  /** Callback to get excluded plugin classes from service */
  private _getExcludedClasses: () => ReadonlySet<PluginClass> = () => new Set();

  /** Instance-specific plugins */
  private _instancePlugins: Set<SsePluginHooks> = new Set();

  /**
   * Instance plugin management namespace
   * Plugins registered here apply only to this SseProtocol instance
   */
  public readonly plugins = {
    /**
     * Add an instance SSE plugin
     * @param plugin - Plugin instance implementing SsePluginHooks
     */
    add: (plugin: SsePluginHooks): void => {
      this._instancePlugins.add(plugin);
    },

    /**
     * Remove an instance SSE plugin
     * Calls destroy() if available
     * @param plugin - Plugin instance to remove
     */
    remove: (plugin: SsePluginHooks): void => {
      if (this._instancePlugins.has(plugin)) {
        this._instancePlugins.delete(plugin);
        plugin.destroy();
      }
    },

    /**
     * Get all instance plugins
     */
    getAll: (): readonly SsePluginHooks[] => {
      return Array.from(this._instancePlugins);
    },
  };

  constructor(config: Readonly<SseProtocolConfig> = {}) {
    super();
    this.config = assign({}, config);
  }

  /**
   * Initialize protocol with base config and plugin accessor
   */
  initialize(
    baseConfig: Readonly<ApiServiceConfig>,
    getExcludedClasses?: () => ReadonlySet<PluginClass>
  ): void {
    // @cpt-begin:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-obtain-protocol
    this.baseConfig = baseConfig;
    if (getExcludedClasses) {
      this._getExcludedClasses = getExcludedClasses;
    }
    // @cpt-end:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-obtain-protocol
  }

  /**
   * Cleanup protocol resources
   */
  cleanup(): void {
    // Close all active connections
    this.connections.forEach((conn) => {
      conn.close();
    });
    this.connections.clear();

    // Cleanup instance plugins
    this._instancePlugins.forEach((plugin) => {
      plugin.destroy();
    });
    this._instancePlugins.clear();
  }

  /**
   * Get global plugins from apiRegistry, filtering out excluded classes.
   * @private
   */
  private getGlobalPlugins(): readonly SsePluginHooks[] {
    // @cpt-begin:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-run-sse-plugins
    const allGlobalPlugins = protocolPluginRegistry.getAll(SseProtocol);
    const excludedClasses = this._getExcludedClasses();

    if (excludedClasses.size === 0) {
      return allGlobalPlugins;
    }

    // Filter out excluded plugin classes
    return allGlobalPlugins.filter((plugin) => {
      for (const excludedClass of excludedClasses) {
        if ((plugin as unknown) instanceof excludedClass) {
          return false;
        }
      }
      return true;
    });
    // @cpt-end:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-run-sse-plugins
  }

  /**
   * Get all plugins in execution order (global first, then instance).
   * Required by ApiProtocol interface for ProtocolPluginType inference.
   */
  getPluginsInOrder(): SsePluginHooks[] {
    // @cpt-begin:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-run-sse-plugins
    return [
      ...this.getGlobalPlugins(),
      ...Array.from(this._instancePlugins),
    ];
    // @cpt-end:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-run-sse-plugins
  }

  /**
   * Execute SSE plugin chain for connection lifecycle
   * Iterates through all SSE-specific plugins and calls onConnect hooks
   *
   * @param context - SSE connection context
   * @returns Modified context or short-circuit response
   */
  private async executePluginChainAsync(
    context: SseConnectContext
  ): Promise<SseConnectContext | { shortCircuit: EventSourceLike }> {
    let currentContext = context;

    for (const plugin of this.getPluginsInOrder()) {
      if (plugin.onConnect) {
        // @cpt-begin:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-run-sse-plugins
        const result = await plugin.onConnect(currentContext);
        // @cpt-end:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-run-sse-plugins

        // @cpt-begin:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-sse-short-circuit
        if (isSseShortCircuit(result)) {
          return result;
        }
        // @cpt-end:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-sse-short-circuit

        currentContext = result;
      }
    }

    return currentContext;
  }

  /**
   * Connect to SSE stream
   * Pure implementation - uses plugin-provided EventSource or creates real one
   *
   * @param url - SSE endpoint URL (relative to baseURL)
   * @param onMessage - Callback for each SSE message
   * @param onComplete - Optional callback when stream completes
   * @returns Connection ID for disconnecting
   */
  // @cpt-begin:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-branch-sse
  async connect(
    url: string,
    onMessage: (event: MessageEvent) => void,
    onComplete?: () => void
  ): Promise<string> {
    const connectionId = this.generateId();

    // Build full URL for plugins (baseURL + relative url)
    const fullUrl = this.baseConfig?.baseURL
      ? `${this.baseConfig.baseURL}${url}`.replace(/\/+/g, '/').replace(':/', '://')
      : url;

    // 1. Build SSE connection context for plugin chain
    // @cpt-begin:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-build-sse-ctx
    const context: SseConnectContext = {
      url: fullUrl,
      headers: {},
    };
    // @cpt-end:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-build-sse-ctx

    // 2. Execute plugin chain - allows plugins to short-circuit with mock EventSource
    // @cpt-begin:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-run-sse-plugins
    const result = await this.executePluginChainAsync(context);
    // @cpt-end:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-run-sse-plugins

    // 3. Determine which EventSource to use
    let eventSource: EventSourceLike;

    // @cpt-begin:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-sse-short-circuit
    if (isSseShortCircuit(result)) {
      // @cpt-begin:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-use-mock-es
      // Plugin provided mock EventSource
      eventSource = result.shortCircuit;
      // @cpt-end:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-use-mock-es
    } else {
      // @cpt-begin:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-real-es
      // Create real EventSource
      const withCredentials = this.config.withCredentials ?? true;
      eventSource = new EventSource(fullUrl, { withCredentials });
      // @cpt-end:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-real-es
    }
    // @cpt-end:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-sse-short-circuit

    // 4. Attach handlers - same code path for both mock and real
    // @cpt-begin:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-receive-events
    // @cpt-begin:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-attach-handlers
    this.attachHandlers(connectionId, eventSource, onMessage, onComplete);
    // @cpt-end:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-attach-handlers
    // @cpt-end:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-receive-events

    // @cpt-begin:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-return-conn-id
    return connectionId;
    // @cpt-end:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-return-conn-id
  // @cpt-end:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-branch-sse
  }

  /**
   * Attach event handlers to EventSource (mock or real)
   * Same implementation for both paths - ensures consistency
   *
   * @param connectionId - Generated connection ID
   * @param eventSource - EventSource to attach handlers to (mock or real)
   * @param onMessage - Callback for each SSE message
   * @param onComplete - Optional callback when stream completes
   */
  private attachHandlers(
    connectionId: string,
    eventSource: EventSourceLike,
    onMessage: (event: MessageEvent) => void,
    onComplete?: () => void
  ): void {
    // @cpt-begin:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-attach-handlers
    // Store connection
    this.connections.set(connectionId, eventSource as EventSource);

    // Attach message handler
    eventSource.onmessage = onMessage;

    // Attach error handler
    eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      this.disconnect(connectionId);
    };

    // Listen for completion signal
    eventSource.addEventListener('done', () => {
      if (onComplete) onComplete();
      this.disconnect(connectionId);
    });
    // @cpt-end:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-attach-handlers
  }

  /**
   * Disconnect SSE stream
   *
   * @param connectionId - Connection ID returned from connect()
   */
  disconnect(connectionId: string): void {
    // @cpt-begin:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-receive-events
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.close();
      this.connections.delete(connectionId);
    }
    // @cpt-end:cpt-frontx-flow-api-protocol-surface-service-call:p1:inst-receive-events
  }

  /**
   * Generate unique connection ID
   */
  private generateId(): string {
    return `sse-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

}
