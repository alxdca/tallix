import type { Request, Response } from 'express';
import { describe, expect, test, vi } from 'vitest';
import {
  clearSessionCookie,
  getSessionToken,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from '../src/auth/sessionCookie.js';

function requestWithHeaders(headers: Request['headers']): Request {
  return { headers } as Request;
}

describe('session cookie auth', () => {
  test('sets the JWT in an HttpOnly cookie', () => {
    const res = { cookie: vi.fn() } as unknown as Response;

    setSessionCookie(res, 'jwt-token');

    expect(res.cookie).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      'jwt-token',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: expect.any(Number),
      })
    );
  });

  test('clears the same session cookie on logout', () => {
    const res = { clearCookie: vi.fn() } as unknown as Response;

    clearSessionCookie(res);

    expect(res.clearCookie).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      })
    );
  });

  test('reads the JWT from the HttpOnly session cookie', () => {
    const req = requestWithHeaders({
      cookie: `theme=dark; ${SESSION_COOKIE_NAME}=cookie-token; locale=en`,
    });

    expect(getSessionToken(req)).toBe('cookie-token');
  });

  test('keeps bearer token fallback for non-browser clients', () => {
    const req = requestWithHeaders({
      authorization: 'Bearer header-token',
      cookie: `${SESSION_COOKIE_NAME}=cookie-token`,
    });

    expect(getSessionToken(req)).toBe('header-token');
  });

  test('returns null when no session credential is present', () => {
    expect(getSessionToken(requestWithHeaders({}))).toBeNull();
  });
});
