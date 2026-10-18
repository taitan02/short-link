import { Server, createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { Registry, collectDefaultMetrics } from 'prom-client';

/**
 * One registry per app instance (not prom-client's global one), so several instances in one
 * process (tests) don't collide. Default metrics cover memory, heap, GC and event-loop lag.
 */
export function createRegistry(app: string): Registry {
  const registry = new Registry();
  registry.setDefaultLabels({ app });
  collectDefaultMetrics({ register: registry });
  return registry;
}

export interface MetricsServerOptions {
  registry: Registry;
  port: number;
  host?: string;
  /** Backs GET /health/ready; GET /health/live always answers 200 while the process runs. */
  ready?: () => Promise<boolean>;
}

/**
 * Plain node:http on its own port, outside the public API: no auth, rate limiting or access
 * logs in the way of scrapes, and the port is simply never published to the internet.
 */
export async function startMetricsServer(options: MetricsServerOptions): Promise<Server> {
  const server = createServer((req, res) => {
    const respond = (status: number, contentType: string, body: string) => {
      res.writeHead(status, { 'Content-Type': contentType }).end(body);
    };

    if (req.method !== 'GET') return respond(405, 'text/plain', 'Method Not Allowed');
    switch (req.url) {
      case '/metrics':
        options.registry
          .metrics()
          .then((body) => respond(200, options.registry.contentType, body))
          .catch(() => respond(500, 'text/plain', 'metrics collection failed'));
        return;
      case '/health/live':
        return respond(200, 'application/json', '{"status":"ok"}');
      case '/health/ready': {
        const ready = options.ready ?? (() => Promise.resolve(true));
        ready()
          .catch(() => false)
          .then((ok) =>
            respond(
              ok ? 200 : 503,
              'application/json',
              JSON.stringify({ status: ok ? 'ok' : 'error' }),
            ),
          )
          .catch(() => undefined);
        return;
      }
      default:
        return respond(404, 'text/plain', 'Not Found');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host ?? '0.0.0.0', () => resolve());
  });
  return server;
}

export function serverPort(server: Server): number {
  return (server.address() as AddressInfo).port;
}

export function stopServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
