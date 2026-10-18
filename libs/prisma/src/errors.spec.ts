import { Prisma } from './generated/prisma/client';
import { databaseUnavailableReason } from './errors';

const known = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('query failed', { code, clientVersion: '7.10.1', meta });

// Shape observed from the pg driver adapter while Postgres was shutting down.
const adapterError = (sqlState: string) =>
  known('P2039', {
    modelName: 'ShortLink',
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: { kind: 'postgres', code: sqlState, originalCode: sqlState, severity: 'FATAL' },
    },
  });

describe('databaseUnavailableReason', () => {
  it.each([
    ['connection refused', known('ECONNREFUSED', { modelName: 'ShortLink' }), 'ECONNREFUSED'],
    ['connection reset', known('ECONNRESET'), 'ECONNRESET'],
    ["can't reach server", known('P1001'), 'P1001'],
    ['pool timeout', known('P2024'), 'P2024'],
    ['server shutting down / starting up', adapterError('57P03'), '57P03'],
    ['admin shutdown', adapterError('57P01'), '57P01'],
    ['statement timeout', adapterError('57014'), '57014'],
    ['too many connections', adapterError('53300'), '53300'],
    ['connection exception class', adapterError('08006'), '08006'],
    [
      'connection dropped by the server (pg-pool)',
      new Error('Connection terminated unexpectedly'),
      'connection-terminated',
    ],
    [
      'client could not initialize',
      new Prisma.PrismaClientInitializationError('down', '7.10.1'),
      'initialization',
    ],
  ])('recognizes %s', (_, error, reason) => {
    expect(databaseUnavailableReason(error)).toBe(reason);
  });

  it.each([
    ['unique violation', known('P2002')],
    ['foreign key violation', known('P2003')],
    ['syntax error from the adapter', adapterError('42601')],
    ['adapter error without a cause', known('P2039', { driverAdapterError: {} })],
    ['plain Error', new Error('ECONNREFUSED')],
    ['non-error value', 'ECONNREFUSED'],
  ])('does not treat %s as an outage', (_, error) => {
    expect(databaseUnavailableReason(error)).toBeUndefined();
  });
});
