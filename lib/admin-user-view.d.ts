export type AdminUserRow = {
  _id: string;
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  isExpert: boolean;
  createdAt: string | null;
};
export const ADMIN_USER_LIST_PROJECTION: Readonly<Record<string, 1>>;
export function toAdminUserRow(doc: Record<string, unknown> & { _id: unknown }): AdminUserRow;
