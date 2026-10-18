import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppExceptionFilter } from './common/app-exception.filter';
import { Env } from './config/env';
import { ApiMetrics } from './metrics/metrics.module';

// The matched route's template. Unknown paths match Nest's catch-all ("{/*splat}"); responses
// sent before routing (e.g. a 413 from the body parser) have no route at all.
function routeTemplate(req: Request): string {
  const route: unknown = req.route;
  return typeof route === 'object' &&
    route !== null &&
    'path' in route &&
    typeof route.path === 'string'
    ? route.path
    : 'unmatched';
}

// Shared by main.ts and the e2e tests so tests exercise the same pipeline as production.
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  const { httpDuration } = app.get(ApiMetrics);
  // First middleware, so the timing includes everything (guards, 401s, 429s, unmatched 404s).
  app.use((req: Request, res: Response, next: NextFunction) => {
    const end = httpDuration.startTimer();
    res.on('finish', () => {
      end({ method: req.method, route: routeTemplate(req), status: String(res.statusCode) });
    });
    next();
  });

  // Makes req.ip the real client address (used by rate limiting) when behind N proxies.
  app.set('trust proxy', config.get('TRUST_PROXY_HOPS', { infer: true }));
  app.use(helmet());
  // Bearer tokens, no cookies: credentials stay off, so CORS can't be abused for CSRF.
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  });
  // Largest legitimate body is a 2 KB URL plus a few fields.
  app.useBodyParser('json', { limit: '16kb' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AppExceptionFilter(app.getHttpAdapter()));

  // Registered before the router is initialized, so /docs wins over the GET /:code catch-all.
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Short-link Platform API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, document);
}
