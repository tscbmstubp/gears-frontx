// @cpt-dod:cpt-frontx-telemetry-dod-declared-events-catalog-type:p1
// @cpt-dod:cpt-frontx-telemetry-dod-declared-events-namespace:p1
// @cpt-dod:cpt-frontx-telemetry-dod-declared-events-reserved-names:p1

// Declared-event catalog types. Everything here exists only for the type checker: nothing of it
// reaches the built code.

declare const catalogErrorBrand: unique symbol;

/**
 * The type a failed catalog check resolves to. No value can be written for it, so any call that
 * needs it fails to compile; `Message` names the broken rule.
 */
export type TelemetryCatalogError<Message extends string> = {
  readonly [catalogErrorBrand]: Message;
};

/** The type a passed catalog check resolves to. */
export type TelemetryCatalogOk = true;

/** "No catalog": the client's default catalog type. It declares no name. */
export type TelemetryNoCatalog = object;

/** The catalog's declared names. */
export type CatalogName<C> = Extract<keyof C, string>;

/** The data type the catalog declares for `N`. */
export type CatalogData<C, N extends CatalogName<C>> = C[N];

type FirstSegment<N extends string> = N extends `${infer Head}.${string}` ? Head : N;

/**
 * The first segment the catalog's names share; a union when they do not share one, `never` when
 * the catalog declares no name.
 */
export type CatalogNamespace<C> = FirstSegment<CatalogName<C>>;

/** `true` when `T` is a union of two or more types; `false` for a single type. */
export type IsUnion<T, All = T> = T extends unknown ? ([All] extends [T] ? false : true) : never;

// @cpt-begin:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-read-segments
type HasTwoSegments<N extends string> = N extends `${string}.${infer Rest}`
  ? Rest extends ''
    ? false
    : true
  : false;
// @cpt-end:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-read-segments

type IsNamedRecord<D> = D extends object
  ? D extends readonly unknown[] | ((...args: never[]) => unknown)
    ? false
    : true
  : false;

// @cpt-begin:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-each-declared-name
// @cpt-begin:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-check-two-segments
// @cpt-begin:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-refuse-one-segment
type OneSegmentNames<C> = {
  [N in CatalogName<C>]: HasTwoSegments<N> extends true ? never : N;
}[CatalogName<C>];
// @cpt-end:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-refuse-one-segment
// @cpt-end:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-check-two-segments
// @cpt-begin:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-check-data-shape-kind
// @cpt-begin:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-refuse-data-shape-kind
type BadDataNames<C> = {
  [N in CatalogName<C>]: IsNamedRecord<C[N]> extends true ? never : N;
}[CatalogName<C>];
// @cpt-end:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-refuse-data-shape-kind
// @cpt-end:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-check-data-shape-kind
// @cpt-end:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-each-declared-name

// Whether a value type is JSON-like: strings, numbers, booleans, null, and arrays and records of
// these. A property may also be undefined, which JSON leaves out. Records are walked property by
// property rather than tested against an index signature, so an interface-declared shape passes.
// A Date, Map, Set, typed array or ArrayBuffer fails through its methods, and a function, bigint,
// symbol, `unknown` or `any` fails outright. The walk stops after ten levels and accepts what lies
// deeper, so a recursive shape such as a tree or a general JSON type compiles; the gate's copy
// still checks that data at runtime.
type IsAny<V> = 0 extends 1 & V ? true : false;

type JsonLikeResult<V, Depth extends unknown[] = []> = Depth['length'] extends 10
  ? true
  : IsAny<V> extends true
    ? false
    : V extends string | number | boolean | null | undefined
      ? true
      : V extends bigint | symbol | ((...args: never[]) => unknown)
        ? false
        : V extends readonly (infer Item)[]
          ? JsonLikeResult<Item, [...Depth, unknown]>
          : V extends object
            ? { [K in keyof V]-?: JsonLikeResult<V[K], [...Depth, unknown]> }[keyof V]
            : false;

// @cpt-begin:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-check-data-values-json-like
type NonJsonDataNames<C> = {
  [N in CatalogName<C>]: [JsonLikeResult<C[N]>] extends [true] ? never : N;
}[CatalogName<C>];
// @cpt-end:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-check-data-values-json-like

// @cpt-begin:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-check-reserved-namespace
type ReservedNamespace = '' | 'frontx' | 'page_view' | 'session_start' | `autocapture_${string}`;
// @cpt-end:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-check-reserved-namespace

// The rules a catalog must pass on its own, before a namespace is compared with it.
// @cpt-algo:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1
type CatalogShapeCheck<C> = [OneSegmentNames<C>] extends [never]
  ? [BadDataNames<C>] extends [never]
    ? [NonJsonDataNames<C>] extends [never]
      ? // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-check-shared-segment
      IsUnion<CatalogNamespace<C>> extends true
      ? // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-refuse-mixed-namespaces
        TelemetryCatalogError<'The catalog names do not share one first segment'>
      : // @cpt-end:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-refuse-mixed-namespaces
        // @cpt-end:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-check-shared-segment
        // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-derive-namespace
        CatalogNamespace<C> extends ReservedNamespace
        ? // @cpt-end:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-derive-namespace
          // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-refuse-reserved-namespace
          TelemetryCatalogError<`The namespace "${CatalogNamespace<C>}" is empty or reserved`>
        : // @cpt-end:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-refuse-reserved-namespace
          TelemetryCatalogOk
      : // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-refuse-non-json-values
        TelemetryCatalogError<`The data of "${NonJsonDataNames<C>}" holds a value that is not JSON-like (strings, numbers, booleans, null, and arrays or records of them)`>
    : // @cpt-end:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-refuse-non-json-values
      TelemetryCatalogError<`The data of "${BadDataNames<C>}" is not a record of named values`>
  : TelemetryCatalogError<`The name "${OneSegmentNames<C>}" has fewer than two segments`>;

/**
 * Checks an event catalog against the namespace given beside it: the client's namespace option or
 * a microfrontend's namespace. Resolves to `true` when every name has at least two dot-separated
 * segments, every data shape is a record of named JSON-like values, all names share one non-reserved first
 * segment and `NS` is exactly that segment; otherwise to a {@link TelemetryCatalogError}. A catalog
 * that declares no name needs no namespace and always passes.
 *
 * @example
 * type BillingEvents = { 'billing.invoice_opened': { invoiceId: string } };
 * const accepted: CatalogCheck<BillingEvents, 'billing'> = true;
 */
// @cpt-flow:cpt-frontx-telemetry-flow-declared-events-mfe-catalog:p1
// @cpt-begin:cpt-frontx-telemetry-flow-declared-events-mfe-catalog:p1:inst-write-mfe-catalog
// @cpt-begin:cpt-frontx-telemetry-flow-declared-events-mfe-catalog:p1:inst-check-mfe-catalog
export type CatalogCheck<C, NS extends string | undefined> =
  // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-check-no-catalog
  [CatalogName<C>] extends [never]
    ? // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-accept-no-catalog
      TelemetryCatalogOk
    : // @cpt-end:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-accept-no-catalog
      // @cpt-end:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-check-no-catalog
      // @cpt-begin:cpt-frontx-telemetry-flow-declared-events-mfe-catalog:p1:inst-check-mfe-catalog-fails
      CatalogShapeCheck<C> extends TelemetryCatalogOk
      ? // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-check-namespace-given
        [NS] extends [undefined]
        ? // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-refuse-missing-namespace
          TelemetryCatalogError<'No namespace is given beside the catalog'>
        : // @cpt-end:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-refuse-missing-namespace
          // @cpt-end:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-check-namespace-given
          // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-check-namespace-matches
          [NS] extends [CatalogNamespace<C>]
          ? [CatalogNamespace<C>] extends [NS]
            ? // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-accept-catalog
              // @cpt-begin:cpt-frontx-telemetry-flow-declared-events-mfe-catalog:p1:inst-return-mfe-declared
              TelemetryCatalogOk
            : // @cpt-end:cpt-frontx-telemetry-flow-declared-events-mfe-catalog:p1:inst-return-mfe-declared
              // @cpt-end:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-accept-catalog
              // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-refuse-mismatched-namespace
              TelemetryCatalogError<`The namespace must be exactly "${CatalogNamespace<C>}"`>
          : TelemetryCatalogError<`The namespace must be exactly "${CatalogNamespace<C>}"`>
        : // @cpt-end:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-refuse-mismatched-namespace
          // @cpt-end:cpt-frontx-telemetry-algo-declared-events-catalog-rules:p1:inst-check-namespace-matches
          // @cpt-begin:cpt-frontx-telemetry-flow-declared-events-mfe-catalog:p1:inst-refuse-mfe-catalog
          CatalogShapeCheck<C>;
// @cpt-end:cpt-frontx-telemetry-flow-declared-events-mfe-catalog:p1:inst-refuse-mfe-catalog
// @cpt-end:cpt-frontx-telemetry-flow-declared-events-mfe-catalog:p1:inst-check-mfe-catalog-fails
// @cpt-end:cpt-frontx-telemetry-flow-declared-events-mfe-catalog:p1:inst-check-mfe-catalog
// @cpt-end:cpt-frontx-telemetry-flow-declared-events-mfe-catalog:p1:inst-write-mfe-catalog
