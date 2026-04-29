/**
 * Custom Next.js server with Socket.IO support
 * Run with: npm run dev
 */
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { initializeSocketIO } = require('./lib/socket-server');
const { logger } = require('./lib/logger');

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      logger.error('Error handling request', { err });
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });

  // Initialize Socket.IO on the HTTP server
  const io = initializeSocketIO(httpServer);

  httpServer.listen(port, (err) => {
    if (err) throw err;
    logger.info('HTTP server ready', { url: `http://${hostname}:${port}` });
    logger.info('Socket.IO server initialized', { url: `ws://${hostname}:${port}` });
  });
});
