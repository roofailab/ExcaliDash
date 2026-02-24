import bcrypt from "bcrypt";
import { config } from "../config";

export const API_KEY_HEADER = "x-api-key";

export const validateApiKey = async (plainKey: string): Promise<boolean> => {
  for (const hashedKey of config.apiKeys) {
    if (await bcrypt.compare(plainKey, hashedKey)) {
      return true;
    }
  }
  return false;
};
