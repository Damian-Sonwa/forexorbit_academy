import type { MongoClient, MongoClientOptions } from 'mongodb';

export function clientOptions(env?: Record<string, string | undefined>): MongoClientOptions;
export function connectShared(client: typeof MongoClient, uri: string, holder?: unknown): Promise<MongoClient>;
