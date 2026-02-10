const express = require('express');
const path = require('path');
const router = express.Router();

/**
 * Serves the Agent-Aware Architecture files from the /.well-known directory.
 */
router.use('/.well-known', express.static(path.join(__dirname, '../public/.well-known')));

router.get('/.well-known/*', (req, res, next) => {
  console.log(`[Agent Discovery] Request for ${req.path}`);
  next();
});

module.exports = router;
