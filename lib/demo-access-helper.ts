/**
 * Demo Access Helper
 * Manages demo unlock access using localStorage
 * This is a non-intrusive system that doesn't modify the database
 */

import { DEMO_ACCESS_DURATION } from './demo-unlock-config';

export interface DemoAccess {
  lessonId: string;
  unlockedAt: number; // timestamp
  expiresAt: number; // timestamp
}

const STORAGE_KEY = 'forexorbit_demo_access';

/**
 * Get all demo access records from localStorage
 */
function getAllDemoAccess(): Record<string, DemoAccess> {
  if (typeof window === 'undefined') return {};
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    return JSON.parse(stored);
  } catch (error) {
    console.warn('Failed to read demo access from localStorage:', error);
    return {};
  }
}

/**
 * Save demo access records to localStorage
 */
function saveDemoAccess(access: Record<string, DemoAccess>): void {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(access));
  } catch (error) {
    console.warn('Failed to save demo access to localStorage:', error);
  }
}

/**
 * Check if a lesson has valid demo access
 * @param lessonId - The lesson ID to check
 * @returns true if lesson has valid demo access, false otherwise
 */
export function hasDemoAccess(lessonId: string): boolean {
  const access = getAllDemoAccess();
  const lessonAccess = access[lessonId];
  
  if (!lessonAccess) return false;
  
  // Check if access has expired
  const now = Date.now();
  if (now > lessonAccess.expiresAt) {
    // Remove expired access
    delete access[lessonId];
    saveDemoAccess(access);
    return false;
  }
  
  return true;
}

/**
 * Grant demo access to a lesson
 * @param lessonId - The lesson ID to unlock
 */
export function grantDemoAccess(lessonId: string): void {
  const access = getAllDemoAccess();
  const now = Date.now();
  
  access[lessonId] = {
    lessonId,
    unlockedAt: now,
    expiresAt: now + DEMO_ACCESS_DURATION,
  };
  
  saveDemoAccess(access);
}

/**
 * Revoke demo access for a lesson
 * @param lessonId - The lesson ID to revoke access for
 */
export function revokeDemoAccess(lessonId: string): void {
  const access = getAllDemoAccess();
  delete access[lessonId];
  saveDemoAccess(access);
}

/**
 * Get demo access info for a lesson
 * @param lessonId - The lesson ID
 * @returns DemoAccess object or null if no access
 */
export function getDemoAccess(lessonId: string): DemoAccess | null {
  const access = getAllDemoAccess();
  const lessonAccess = access[lessonId];
  
  if (!lessonAccess) return null;
  
  // Check if expired
  const now = Date.now();
  if (now > lessonAccess.expiresAt) {
    delete access[lessonId];
    saveDemoAccess(access);
    return null;
  }
  
  return lessonAccess;
}

/**
 * Clear all expired demo access records
 */
export function cleanupExpiredAccess(): void {
  const access = getAllDemoAccess();
  const now = Date.now();
  let hasChanges = false;
  
  for (const lessonId in access) {
    if (now > access[lessonId].expiresAt) {
      delete access[lessonId];
      hasChanges = true;
    }
  }
  
  if (hasChanges) {
    saveDemoAccess(access);
  }
}



