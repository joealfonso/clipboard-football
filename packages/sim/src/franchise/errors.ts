// Typed results for the franchise layer (Locked 8): an action that is not allowed returns an
// error value and leaves the state unchanged. Nothing here throws.

import type { FranchiseError, FranchiseResult } from "../../../shared/src/franchise";

export function ok<T>(value: T): FranchiseResult<T> {
  return { ok: true, value };
}

export function err<T = never>(error: FranchiseError): FranchiseResult<T> {
  return { ok: false, error };
}
