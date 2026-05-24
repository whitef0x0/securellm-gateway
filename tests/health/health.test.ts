import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';

describe('health + liveness endpoints', () => {
  const app = createApp();

  it('GET /livez returns 200 and alive status', async () => {
    const res = await request(app).get('/livez');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'alive' });
  });

  it('GET /healthz returns 200 and a minimal healthy status (no component internals)', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'healthy' });
  });

  it('attaches an X-Request-Id correlation header', async () => {
    const res = await request(app).get('/livez');
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});
