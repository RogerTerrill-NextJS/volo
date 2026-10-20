/** Format normalization only: an identifier is not a verified airport lookup. */
export function normalizeAirportIdentifier(raw:unknown):string|null {
  if(typeof raw!=='string'||!raw.isWellFormed()||raw.includes('\u0000'))return null;
  const value=raw.trim().toUpperCase();
  return /^[A-Z0-9]{2,8}$/.test(value)?value:null;
}
