import clsx, { type ClassValue } from 'clsx';

/** Small helper around clsx so components stay readable. */
export function cn(...values: ClassValue[]): string {
  return clsx(values);
}
