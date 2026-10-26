export const COMMUNITY_NEWS_CLIENT_ERROR: string;

export function presentCommunityNews(
  item: { [key: string]: any } | null,
  userId: unknown
): {
  _id: string;
  title: string;
  description: string;
  category: string;
  content: string | null;
  link: string | null;
  createdAt: unknown;
  createdBy: string | null;
  isRead: boolean;
};

export function logCommunityNewsFailure(event: string): void;
