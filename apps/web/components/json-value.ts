/**
 * A JSON value, for typing a structured-data graph without reaching for `any`.
 *
 * A schema graph is a plain JSON document — objects, arrays, strings, numbers, booleans, null — and typing it
 * as such is what lets it be assembled conditionally without each assignment widening to `unknown`.
 */
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };
