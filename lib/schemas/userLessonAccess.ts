/**
 * userLessonAccess collection (native MongoDB driver — not Mongoose).
 * Collection name: `userLessonAccess` (see USER_ACCESS_COLLECTION in lesson-monetization.ts).
 *
 * Optional Mongoose schema (add `mongoose` dependency if you migrate):
 * @example
 * new mongoose.Schema({
 *   userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
 *   lessonId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Lesson' },
 *   paid: { type: Boolean, default: false },
 *   unlockedAt: { type: Date, default: Date.now },
 * });
 */

/** Shape stored in MongoDB after verified Paystack payment */
export type UserLessonAccessDocument = {
  userId: string;
  lessonId: string;
  courseId: string;
  paid: true;
  unlockedAt: Date;
  paystackReference?: string;
  amountKobo?: number;
  currency?: string;
  verifiedAt?: Date;
  createdAt?: Date;
  source?: string;
};
