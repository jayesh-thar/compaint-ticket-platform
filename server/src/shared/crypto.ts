import crypto from 'node:crypto';
import argon2 from 'argon2';

export const generateToken = (bytes = 32): string => {
  return crypto.randomBytes(bytes).toString('base64url');
};

export const hashToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

export const normalizeEmail = (email: string): string => {
  return email.trim().toLowerCase();
};

export const hashPassword = async (password: string): Promise<string> => {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456, // 19 MiB
    timeCost: 2,
    parallelism: 1,
  });
};

export const verifyPassword = async (hash: string, password: string): Promise<boolean> => {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
};
