import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { config } from "../../config";
import { createAuthMiddleware } from "../auth";

const createRequest = (overrides?: Partial<Request>): Request =>
  ({
    method: "GET",
    originalUrl: "/drawings",
    url: "/drawings",
    headers: {},
    ...overrides,
  }) as Request;

const createResponse = (): Response =>
  ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  }) as unknown as Response;

const ciUser = {
  id: "ci-user-id",
  username: "ci",
  email: "ci@excalidash.local",
  name: "CI Service Account",
  role: "USER",
  mustResetPassword: false,
};

const makeAccessToken = () =>
  jwt.sign(
    { userId: "user-1", email: "user-1@test.local", type: "access" },
    config.jwtSecret
  );

const createDeps = () => {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  } as any;

  const authModeService = {
    getAuthEnabled: vi.fn().mockResolvedValue(true),
    getBootstrapActingUser: vi.fn(),
  } as any;

  return { prisma, authModeService };
};

describe("requireAuthOrApiKey", () => {
  let plainKey: string;
  let originalApiKeys: string[];
  let originalEmail: string;

  beforeAll(async () => {
    originalApiKeys = config.apiKeys;
    originalEmail = config.ciServiceAccountEmail;
    plainKey = "test-ci-key";
    const hash = await bcrypt.hash(plainKey, 10);
    config.apiKeys = [hash];
    config.ciServiceAccountEmail = ciUser.email;
  });

  afterAll(() => {
    config.apiKeys = originalApiKeys;
    config.ciServiceAccountEmail = originalEmail;
  });

  it("returns 200 and attaches CI user for valid X-API-Key", async () => {
    const { prisma, authModeService } = createDeps();
    prisma.user.findFirst.mockResolvedValue(ciUser);
    const { requireAuthOrApiKey } = createAuthMiddleware({ prisma, authModeService });

    const req = createRequest({ headers: { "x-api-key": plainKey } });
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    await requireAuthOrApiKey(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ id: ciUser.id, email: ciUser.email });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 401 for invalid X-API-Key", async () => {
    const { prisma, authModeService } = createDeps();
    const { requireAuthOrApiKey } = createAuthMiddleware({ prisma, authModeService });

    const req = createRequest({ headers: { "x-api-key": "bad-key" } });
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    await requireAuthOrApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("falls through to JWT auth when X-API-Key is absent", async () => {
    const { prisma, authModeService } = createDeps();
    prisma.user.findUnique.mockResolvedValue({
      ...ciUser,
      id: "user-1",
      email: "user-1@test.local",
      isActive: true,
    });
    const { requireAuthOrApiKey } = createAuthMiddleware({ prisma, authModeService });

    const req = createRequest({
      headers: { authorization: `Bearer ${makeAccessToken()}` },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    await requireAuthOrApiKey(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user?.email).toBe("user-1@test.local");
  });
});

describe("optionalAuthOrApiKey", () => {
  let plainKey: string;
  let originalApiKeys: string[];
  let originalEmail: string;

  beforeAll(async () => {
    originalApiKeys = config.apiKeys;
    originalEmail = config.ciServiceAccountEmail;
    plainKey = "test-ci-key-optional";
    const hash = await bcrypt.hash(plainKey, 10);
    config.apiKeys = [hash];
    config.ciServiceAccountEmail = ciUser.email;
  });

  afterAll(() => {
    config.apiKeys = originalApiKeys;
    config.ciServiceAccountEmail = originalEmail;
  });

  it("attaches CI user for valid X-API-Key", async () => {
    const { prisma, authModeService } = createDeps();
    prisma.user.findFirst.mockResolvedValue(ciUser);
    const { optionalAuthOrApiKey } = createAuthMiddleware({ prisma, authModeService });

    const req = createRequest({ headers: { "x-api-key": plainKey } });
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    await optionalAuthOrApiKey(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ id: ciUser.id });
  });

  it("returns 401 for invalid X-API-Key", async () => {
    const { prisma, authModeService } = createDeps();
    const { optionalAuthOrApiKey } = createAuthMiddleware({ prisma, authModeService });

    const req = createRequest({ headers: { "x-api-key": "bad-key" } });
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    await optionalAuthOrApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
