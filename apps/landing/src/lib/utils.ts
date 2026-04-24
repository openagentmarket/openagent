// FILE: utils.ts
// Purpose: Hold small shared client-safe utilities reused across UI components.
// Layer: Utility helpers
// Exports: cn

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

// Merges conditional Tailwind class names into one conflict-free string.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
