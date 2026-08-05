/**
 * RestEndpointProtocol - Declarative REST endpoint descriptors
 *
 * Owns the descriptor contract for cacheable REST endpoints while delegating
 * imperative execution to an injected RestProtocol instance.
 */

import {
  ApiProtocol,
  type ApiServiceConfig,
  type BasePluginHooks,
  type EndpointDescriptor,
  type EndpointOptions,
  type MutationDescriptor,
  type MutationMethod,
  type ParameterizedEndpointDescriptor,
  type PluginClass,
} from '../types';
import { RestProtocol } from './RestProtocol';

/**
 * Declarative REST descriptor contract.
 *
 * This contract is separate from RestProtocol's imperative get/post/put API so
 * services can opt into either or both styles explicitly.
 */
// @cpt-algo:cpt-frontx-algo-api-protocol-surface-descriptor-derivation:p1
export class RestEndpointProtocol extends ApiProtocol<BasePluginHooks> {
  private config: Readonly<ApiServiceConfig> | null = null;

  constructor(private readonly rest: RestProtocol) {
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

  query<TData>(
    path: string,
    options?: EndpointOptions
  ): EndpointDescriptor<TData> {
    const config = this.getConfig();
    // @cpt-begin:cpt-frontx-algo-api-protocol-surface-descriptor-derivation:p1:inst-derive-endpoint-key
    const key = [config.baseURL, 'GET', path] as const;
    // @cpt-end:cpt-frontx-algo-api-protocol-surface-descriptor-derivation:p1:inst-derive-endpoint-key

    // @cpt-begin:cpt-frontx-algo-api-protocol-surface-descriptor-derivation:p1:inst-build-query-descriptor
    return {
      key,
      fetch: ({ signal, staleTime } = {}) => {
        return this.rest.getWithSharedCache<TData>(path, {
          descriptorKey: key,
          signal,
          staleTime: staleTime ?? options?.staleTime,
        });
      },
      ...(options?.staleTime !== undefined && { staleTime: options.staleTime }),
      ...(options?.gcTime !== undefined && { gcTime: options.gcTime }),
    };
    // @cpt-end:cpt-frontx-algo-api-protocol-surface-descriptor-derivation:p1:inst-build-query-descriptor
  }

  queryWith<TData, TParams>(
    pathFn: (params: TParams) => string,
    options?: EndpointOptions
  ): ParameterizedEndpointDescriptor<TData, TParams> {
    const config = this.getConfig();

    return (params: TParams): EndpointDescriptor<TData> => {
      // @cpt-begin:cpt-frontx-algo-api-protocol-surface-descriptor-derivation:p1:inst-resolve-param-path
      const resolvedPath = pathFn(params);
      const key = [config.baseURL, 'GET', resolvedPath, { ...params }] as const;
      // @cpt-end:cpt-frontx-algo-api-protocol-surface-descriptor-derivation:p1:inst-resolve-param-path

      // @cpt-begin:cpt-frontx-algo-api-protocol-surface-descriptor-derivation:p1:inst-build-query-descriptor
      return {
        key,
        fetch: ({ signal, staleTime } = {}) => {
          return this.rest.getWithSharedCache<TData>(resolvedPath, {
            descriptorKey: key,
            signal,
            staleTime: staleTime ?? options?.staleTime,
          });
        },
        ...(options?.staleTime !== undefined && { staleTime: options.staleTime }),
        ...(options?.gcTime !== undefined && { gcTime: options.gcTime }),
      };
      // @cpt-end:cpt-frontx-algo-api-protocol-surface-descriptor-derivation:p1:inst-build-query-descriptor
    };
  }

  mutation<TData, TVariables>(
    method: MutationMethod,
    path: string
  ): MutationDescriptor<TData, TVariables> {
    const config = this.getConfig();
    // @cpt-begin:cpt-frontx-algo-api-protocol-surface-descriptor-derivation:p1:inst-derive-endpoint-key
    const key = [config.baseURL, method, path] as const;
    // @cpt-end:cpt-frontx-algo-api-protocol-surface-descriptor-derivation:p1:inst-derive-endpoint-key

    // @cpt-begin:cpt-frontx-algo-api-protocol-surface-descriptor-derivation:p1:inst-build-mutation-descriptor
    return {
      key,
      fetch: (variables: TVariables, options?: { signal?: AbortSignal }) => {
        switch (method) {
          case 'DELETE':
            return this.rest.delete<TData, TVariables>(path, variables, {
              signal: options?.signal,
            });
          case 'POST':
            return this.rest.post<TData, TVariables>(path, variables, {
              signal: options?.signal,
            });
          case 'PUT':
            return this.rest.put<TData, TVariables>(path, variables, {
              signal: options?.signal,
            });
          case 'PATCH':
            return this.rest.patch<TData, TVariables>(path, variables, {
              signal: options?.signal,
            });
        }
      },
    };
    // @cpt-end:cpt-frontx-algo-api-protocol-surface-descriptor-derivation:p1:inst-build-mutation-descriptor
  }

  private getConfig(): Readonly<ApiServiceConfig> {
    // @cpt-begin:cpt-frontx-algo-api-protocol-surface-descriptor-derivation:p1:inst-guard-config
    if (!this.config) {
      throw new Error('RestEndpointProtocol not initialized. Call initialize() first.');
    }

    return this.config;
    // @cpt-end:cpt-frontx-algo-api-protocol-surface-descriptor-derivation:p1:inst-guard-config
  }
}
