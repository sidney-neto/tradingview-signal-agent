'use strict';

const { Router } = require('express');

const router = Router();

/**
 * GET /health
 *
 * Returns a basic health payload indicating the API is running.
 * This endpoint does not perform external adapter checks — it is intentionally
 * lightweight so that load balancers and monitoring systems receive a fast response.
 */
router.get('/', (_req, res) => {
  res.json({ status: 'ok' });
});

module.exports = router;
