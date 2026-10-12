// Vercel entry point. vercel.json rewrites /api/<anything> to /api/index?path=<anything>, so this
// rebuilds the original path whether or not the platform hands us the rewritten URL.
import { createApi } from '../lib/api.js';

var handle = createApi(process.env);

function restorePath(request) {
  var url = new URL(request.url);
  var p = url.searchParams.get('path');
  if (p == null || url.pathname.indexOf('/api/index') !== 0) return request;
  url.searchParams.delete('path');
  url.pathname = '/api/' + p;
  return new Request(url, request);
}

function entry(request) { return handle(restorePath(request)); }
export { entry as GET, entry as POST, entry as PUT, entry as DELETE };
