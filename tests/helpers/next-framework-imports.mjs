import {registerHooks} from 'node:module';

/** Execute real route handlers with Next's extensionless framework imports in Node 24. */
export function registerNextFrameworkImports() {
  return registerHooks({resolve(specifier,context,nextResolve) {
    return nextResolve(['next/server','next/headers'].includes(specifier)?specifier+'.js':specifier,context);
  }});
}
