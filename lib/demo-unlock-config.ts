/**
 * Demo Unlock Feature Configuration
 * Feature flag to enable/disable demo unlock system
 * Set to false to instantly disable the feature
 */

export const DEMO_UNLOCK_ENABLED = true; // Feature flag - set to false to disable

/**
 * Demo access expiration time in milliseconds
 * Default: 24 hours
 */
export const DEMO_ACCESS_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if user is premium/paid
 * This is a placeholder - replace with actual premium check logic
 */
export function isPremiumUser(user: { role?: string; subscription?: { status?: string } } | null | undefined): boolean {
  // TODO: Replace with actual premium check
  // For now, return false (no premium users)
  // Example: return user?.subscription?.status === 'active' || user?.role !== 'student';
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _ = user; // Placeholder for future use
  return false;
}

