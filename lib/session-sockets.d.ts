import type { Server } from 'socket.io';

export function endSocketsForFamily(io: Server | null, familyId: string): void;
export function endSocketsForUser(io: Server | null, userId: string): void;
export function registerSessionSocketServer(io: Server): void;
export function sessionSocketServer(): Server | null;
