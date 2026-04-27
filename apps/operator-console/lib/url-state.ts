"use client";

import {
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryState,
  type Options,
} from "nuqs";

export const replaceOpts: Options = { history: "replace", shallow: true };
export const pushOpts: Options = { history: "push", shallow: true };

export const useStringFilter = (key: string, defaultValue = "") =>
  useQueryState(
    key,
    parseAsString.withDefault(defaultValue).withOptions(replaceOpts),
  );

export const useArrayFilter = (key: string) =>
  useQueryState(
    key,
    parseAsArrayOf(parseAsString).withDefault([]).withOptions(replaceOpts),
  );

export const usePageState = (key = "page") =>
  useQueryState(
    key,
    parseAsInteger.withDefault(1).withOptions(replaceOpts),
  );

export const useEnumState = <T extends string>(
  key: string,
  values: readonly T[],
  defaultValue: T,
) =>
  useQueryState(
    key,
    parseAsStringLiteral(values)
      .withDefault(defaultValue)
      .withOptions(replaceOpts),
  );

export const useSelectedRow = () =>
  useQueryState(
    "row",
    parseAsString.withDefault("").withOptions(pushOpts),
  );

export {
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
};
