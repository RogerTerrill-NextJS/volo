// Match the explicit whitespace set used by the database search normalization.
const whitespace=/[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;

/** Undefined is an unfiltered directory; null means invalid input. */
export function normalizeDirectorySearch(value:unknown):string|null{
 if(value===undefined)return '';
 if(typeof value!=='string'||!value.isWellFormed()||value.includes('\u0000')||[...value].length>80)return null;
 return value.replace(whitespace,' ').replace(/^ | $/g,'');
}
