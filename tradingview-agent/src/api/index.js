'use strict';

/**
 * API entrypoint — boots the HTTP server.
 * Called by `npm run start:api`.
 */

const logger = require('../logger');
const { start } = require('./server');

start().catch((err) => {
  logger.error('api.start.failed', { error: err.message });
  process.exit(1);
});
