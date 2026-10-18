import { Server } from 'node:http';
import { BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

/**
 * Stops accepting connections and waits for in-flight requests before the database and Redis
 * clients close (in onApplicationShutdown). Nest would otherwise close the HTTP server last,
 * after its dependencies are gone. Since Node 19, close() also drops idle keep-alive sockets.
 */
@Injectable()
export class HttpShutdown implements BeforeApplicationShutdown {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  async beforeApplicationShutdown() {
    const server: unknown = this.adapterHost.httpAdapter?.getHttpServer();
    if (!(server instanceof Server) || !server.listening) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
