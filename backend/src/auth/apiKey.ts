import bcrypt from "bcrypt";
import { config } from "../config";
import { PrismaClient } from "../generated/client";

export const API_KEY_HEADER = "x-api-key";

export const validateApiKey = async (plainKey: string): Promise<boolean> => {
  for (const hashedKey of config.apiKeys) {
    if (await bcrypt.compare(plainKey, hashedKey)) {
      return true;
    }
  }
  return false;
};

export const getCiServiceAccountUser = async (
  prisma: PrismaClient
): Promise<NonNullable<Express.Request["user"]>> => {
  const user = await prisma.user.findFirst({
    where: { email: config.ciServiceAccountEmail, isActive: true },
    select: {
      id: true,
      username: true,
      email: true,
      name: true,
      role: true,
      mustResetPassword: true,
    },
  });

  if (!user) {
    throw new Error(
      `CI service account not found or inactive. Create an active user with email ${config.ciServiceAccountEmail}`
    );
  }

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    role: user.role,
    mustResetPassword: user.mustResetPassword,
  };
};
