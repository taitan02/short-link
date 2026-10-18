import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '@short-link/prisma';
import request from 'supertest';
import { createTestApp, registerAndLogin, resetDatabase, uniqueIp } from './utils';

describe('Auth (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const post = (path: string, body: object, ip = uniqueIp()) =>
    request(app.getHttpServer()).post(path).set('X-Forwarded-For', ip).send(body);

  describe('register', () => {
    it('creates a user with a normalized email and never returns the hash', async () => {
      const res = await post('/api/auth/register', {
        email: '  Alice@Example.COM ',
        password: 'correct horse battery staple',
      }).expect(201);

      expect(Object.keys(res.body as object).sort()).toEqual(['createdAt', 'email', 'id']);
      expect(res.body).toMatchObject({ email: 'alice@example.com' });
    });

    it('stores an argon2id hash, not the password', async () => {
      await post('/api/auth/register', {
        email: 'a@example.com',
        password: 'correct horse battery staple',
      }).expect(201);

      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'a@example.com' } });
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.passwordHash).not.toContain('correct horse');
    });

    it('rejects a duplicate email regardless of case', async () => {
      const body = { email: 'dup@example.com', password: 'correct horse battery staple' };
      await post('/api/auth/register', body).expect(201);
      await post('/api/auth/register', { ...body, email: 'DUP@example.com' }).expect(409);
    });

    it.each([
      [{ email: 'not-an-email', password: 'correct horse battery staple' }],
      [{ email: 'a@example.com', password: 'short' }],
      [{ email: 'a@example.com', password: 'x'.repeat(129) }],
      [{ email: 'a@example.com', password: 'correct horse battery staple', isAdmin: true }],
    ])('rejects invalid input %j', async (body) => {
      await post('/api/auth/register', body).expect(400);
    });
  });

  describe('login', () => {
    it('returns a bearer token that authenticates later requests', async () => {
      const { token, user } = await registerAndLogin(app);

      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((res) => expect(res.body).toMatchObject({ id: user.id, email: user.email }));
    });

    it('accepts the email in any case', async () => {
      const { credentials } = await registerAndLogin(app, 'mixed@example.com');
      await post('/api/auth/login', { ...credentials, email: 'MIXED@example.com' }).expect(200);
    });

    it('gives the same answer for a wrong password and an unknown email', async () => {
      const { credentials } = await registerAndLogin(app);

      const wrongPassword = await post('/api/auth/login', {
        ...credentials,
        password: 'wrong password entirely',
      }).expect(401);
      const unknownEmail = await post('/api/auth/login', {
        ...credentials,
        email: 'nobody@example.com',
      }).expect(401);

      expect(wrongPassword.body).toEqual(unknownEmail.body);
    });

    it('locks an IP out after 10 attempts per minute, without affecting other IPs', async () => {
      const ip = uniqueIp();
      const body = { email: 'nobody@example.com', password: 'guess' };
      for (let i = 0; i < 10; i++) await post('/api/auth/login', body, ip).expect(401);

      const blocked = await post('/api/auth/login', body, ip).expect(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      await post('/api/auth/login', body, uniqueIp()).expect(401);
    });
  });

  describe('protected routes', () => {
    const me = (authorization?: string) => {
      const req = request(app.getHttpServer()).get('/api/users/me');
      return authorization ? req.set('Authorization', authorization) : req;
    };

    it('require a token', async () => {
      await me().expect(401);
      await me('Basic dXNlcjpwYXNz').expect(401);
      await me('Bearer not.a.jwt').expect(401);
    });

    it('reject a token signed with another secret', async () => {
      const { user } = await registerAndLogin(app);
      const forged = new JwtService({ secret: 'some-other-secret-of-sufficient-length!!' }).sign({
        sub: user.id,
      });
      await me(`Bearer ${forged}`).expect(401);
    });

    it('reject an expired token', async () => {
      const { user } = await registerAndLogin(app);
      const expired = app.get(JwtService).sign({ sub: user.id }, { expiresIn: -10 });
      await me(`Bearer ${expired}`).expect(401);
    });

    it('reject an unsigned "alg: none" token', async () => {
      const { user } = await registerAndLogin(app);
      const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: user.id })}.`;
      await me(`Bearer ${unsigned}`).expect(401);
    });
  });
});
