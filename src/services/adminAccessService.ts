import { config } from "./configService";

export function isSuperAdmin(userId?: string | null): boolean {
  if (!userId) return false;
  return config.admin.superAdminUserIds.includes(userId);
}
