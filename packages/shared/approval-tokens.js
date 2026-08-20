// Node-only subpath entry for '@approvex/shared/approval-tokens'.
// This module depends on node:crypto and must never be pulled into the web
// bundle, so it is intentionally excluded from the root barrel (dist/index.js)
// and reached only via this physical subpath (classic Node resolution, matching
// the '@approvex/shared/tokens.css' convention used elsewhere in this package).
module.exports = require('./dist/approval-tokens');
