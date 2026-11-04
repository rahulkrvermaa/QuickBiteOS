import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Combines conditional class names and resolves Tailwind CSS collisions cleanly.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Format timestamp into readable IST time (e.g., 01:45 PM).
 */
export function formatTimeIST(dateStringOrTimestamp: string | number | Date): string {
  const date = new Date(dateStringOrTimestamp)
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
  }).format(date)
}

/**
 * Calculates time elapsed in minutes from a timestamp.
 */
export function getElapsedMinutes(dateStringOrTimestamp: string | number | Date): number {
  const past = new Date(dateStringOrTimestamp).getTime()
  const now = Date.now()
  return Math.max(0, Math.floor((now - past) / 60000))
}

/**
 * Safely escapes HTML special characters to prevent Cross-Site Scripting (XSS).
 */
export function escapeHtml(unsafe: string | null | undefined): string {
  if (unsafe == null) return ''
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}


