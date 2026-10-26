export const NOTIFICATION_NOT_FOUND: { error: string };

export const NOTIFICATION_ERRORS: {
  list: string;
  create: string;
  read: string;
  readAll: string;
  remove: string;
};

export function notificationErrorBody(kind: string): { error: string };

export function logNotificationFailure(event: string): void;

export function authorizedCommunityRoomIds(
  member: { userId?: string; role?: string; learningLevel?: string; tradingLevel?: string } | null,
  rooms: Array<{ _id?: unknown; name?: string; type?: string; participants?: unknown[] } | null> | null
): string[];

export function notificationIsVisible(
  doc: { [key: string]: any } | null,
  userId: unknown,
  authorizedRoomIds: readonly string[] | null
): boolean;

export function ownedNotificationQuery(
  userId: unknown,
  authorizedRoomIds: readonly string[] | null,
  options?: { unreadOnly?: boolean }
): { [key: string]: any };

export function presentNotification(doc: { [key: string]: any } | null): {
  _id: string;
  type: string;
  title: string;
  message: string;
  roleTarget?: string;
  userId?: string;
  roomId?: string;
  taskId?: string;
  relatedId?: string;
  read: boolean;
  createdAt: unknown;
  metadata: { [key: string]: any };
};

export function prepareRecipientNotifications(
  params: { [key: string]: any } | null,
  recipientIds: readonly unknown[] | null,
  existing?: Array<{ userId?: unknown; id?: unknown }> | null
): {
  copies: Array<{ [key: string]: any }>;
  retained: Array<{ id: string; userId: string }>;
};

export function createMemoryNotificationStore(): {
  documents: Array<{ [key: string]: any }>;
  deliver(params: { [key: string]: any }, recipientIds: readonly unknown[]): Array<{ id: string; userId: string }>;
  list(userId: unknown, authorizedRoomIds: readonly string[]): Array<{ [key: string]: any }>;
  markRead(
    userId: unknown,
    notificationId: unknown,
    authorizedRoomIds: readonly string[]
  ): { status: number; body: { error?: string; success?: boolean } };
  markAll(userId: unknown, authorizedRoomIds: readonly string[]): number;
};
