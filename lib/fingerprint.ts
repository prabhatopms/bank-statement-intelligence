import { createHash } from 'crypto';

export function computeFingerprint(
  userId: string,
  date: string,
  description: string,
  amount: string | number,
  type: string
): string {
  const raw = `${userId}${date}${description.trim().toLowerCase()}${amount}${type}`;
  return createHash('sha256').update(raw).digest('hex');
}
