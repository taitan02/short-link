import { Server } from 'node:http';
import { Counter } from 'prom-client';
import { createRegistry, serverPort, startMetricsServer, stopServer } from './metrics-server';

describe('metrics server', () => {
  let server: Server;
  let ready = true;
  const registry = createRegistry('test-app');
  const counter = new Counter({ name: 'things_total', help: 'Things', registers: [registry] });

  beforeAll(async () => {
    server = await startMetricsServer({
      registry,
      port: 0,
      host: '127.0.0.1',
      ready: () => Promise.resolve(ready),
    });
  });

  afterAll(async () => {
    await stopServer(server);
  });

  const get = (path: string) => fetch(`http://127.0.0.1:${serverPort(server)}${path}`);

  it('exposes custom and default metrics in Prometheus format with the app label', async () => {
    counter.inc(3);
    const res = await get('/metrics');
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(body).toContain('things_total{app="test-app"} 3');
    expect(body).toContain('process_resident_memory_bytes');
    expect(body).toContain('nodejs_eventloop_lag_seconds');
  });

  it('answers liveness unconditionally and readiness from the callback', async () => {
    expect((await get('/health/live')).status).toBe(200);
    expect((await get('/health/ready')).status).toBe(200);
    ready = false;
    expect((await get('/health/ready')).status).toBe(503);
  });

  it('serves nothing else', async () => {
    expect((await get('/')).status).toBe(404);
    expect(
      (await fetch(`http://127.0.0.1:${serverPort(server)}/metrics`, { method: 'POST' })).status,
    ).toBe(405);
  });

  it('keeps registries independent', () => {
    const other = createRegistry('other');
    expect(
      () => new Counter({ name: 'things_total', help: 'x', registers: [other] }),
    ).not.toThrow();
  });
});
