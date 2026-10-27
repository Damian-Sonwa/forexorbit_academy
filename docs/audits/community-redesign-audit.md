# Community redesign audit

Date: 26 October 2026. Local workspace only. No production migration, index creation, or data write was run.

## Original architecture

The community was a level-locked group chat.

- Page: `pages/community.tsx` opened a room, joined a Socket.IO channel, and rendered a continuous message stream with typing, read receipts, reactions, uploads, and a news panel.
- Rooms: `communityRooms`. The rooms API ensures three global rooms named Beginner, Intermediate, and Advanced. Students can enter only the room that matches `learningLevel` or `studentDetails.tradingLevel`. Staff can enter every level room. Direct and group rooms require a stored participant id.
- Messages: `communityMessages`, tied to `roomId`, with `senderId`, type, content, file fields, reactions, and `seenBy`.
- APIs: `pages/api/community/rooms.ts`, `messages.ts`, `messages/[id].ts`, `messages/[id]/reaction.ts`, `messages/read.ts`, `messages/upload.ts`, and `news`.
- Sockets: `server.js` handles `joinRoom` through `decideCommunityRoomJoin`. The client does not choose an authorized channel by itself. The public socket name `community_global` is separate from the level rooms.
- Access: `withAuth` loads the live user record. `lib/account-access.js` decides room and message access. The `COMMUNITY` feature flag still gates `/community` and `/api/community`.
- Uploads write a chat message into a room the member can access. They are not a general attachment service.
- Notifications for chat are personal copies. Room-wide fan-out stays behind `createNotificationForRoom` and the existing membership check.

## What was kept

- All chat collections, room rules, socket authorization, news routes, and message APIs remain.
- Existing messages and attachments are not deleted or rewritten.
- Students still cannot enter another level's chat room. A discussion category does not grant that access.
- Feature-flag, session, and CORS behavior are unchanged.
- Unexpected server failures still use `unexpectedBody` and do not return exception text.

## Security notes from the audit

- Chat authorization is server-side and level-aware. That path was not loosened.
- Message reads enrich senders one user at a time. That N+1 pattern stays in the legacy chat API.
- The chat upload creates a room message. Reusing it for questions would post into a level room, so the Q&A composer does not upload files.
- Socket room joins already require a database membership decision. A new public discussion socket was not added.

## New experience

`/community` is a question feed. `/community/ask` creates a question. `/community/questions/[id]` is the discussion.

Members can search, filter by category, unanswered, popular, and their own activity, and sort by activity, newest, votes, or replies. Each question shows title, plain-text preview, author, time, reply count, score, and answered state. Votes and an accepted answer are enforced on the server.

Categories are labels, not rooms:

- Beginner Questions
- Market Structure
- Technical Analysis
- Risk Management
- Trading Psychology
- Strategy and Trade Review
- Platform and Learning Support

There is no Following tab. The product has no follow relationship.

## Data model

New collections only:

- `communityQuestions`: author, title, plain-text body, category, `acceptedReplyId`, `replyCount`, `score`, timestamps, `lastActivityAt`.
- `communityReplies`: question id, author, plain-text body, score, timestamps.
- `communityVotes`: user id, target id, `question` or `reply`, and value `1` or `-1`.

The acting user always comes from the verified session. Clients cannot set the author, score, or accepted answer directly.

Vote policy: one active vote per user per item. The same vote again removes it. The opposite vote replaces it. Authors cannot vote on their own question or reply. A compare-and-set update, plus duplicate-key handling, is the application guard. A unique index is specified but was not created:

`communityVotes { userId: 1, targetId: 1, targetType: 1 } unique`

`scripts/community-qa-indexes.js` prints the index plan and exits with an error if `--apply` is passed. It never connects to MongoDB. Creating that index still needs a separate approval, and it must not be created against production from this change.

Accepted answers: the question author or a moderator (instructor, admin, superadmin) may set one reply. Clearing it stores null. Deleting that reply sets `acceptedReplyId` back to null. The accepted flag is not trusted from the client.

Owners can edit and delete their questions and replies. Moderators can also do so. Deleting a question removes its Q&A replies and votes only.

Helpful score on a discussion is the sum of that author's question and reply scores. It is not a separate counter a user can write.

## API

Authenticated routes under the existing community flag:

- `GET/POST /api/community/questions`
- `GET/PUT/DELETE /api/community/questions/:id`
- `POST /api/community/questions/:id/replies`
- `PUT/DELETE /api/community/questions/:id/replies/:replyId`
- `POST /api/community/questions/:id/vote`
- `POST /api/community/questions/:id/accept`

Search text is escaped before it becomes a regular expression. Sort, view, category, and page values are allow-listed. List responses are paged, with a maximum of 20 questions. Replies are paged at 30.

A reply notifies only the question author. Accepting a reply notifies only that reply's author, and not when they accepted their own reply. Both use one personal `system_alert` with a community path and a dedupe key. They do not fan out to a room.

Creating a question is limited to 6 per 10 minutes per member, and a reply to 20, in process memory. That limit does not span multiple server processes.

## Real time

The feed and discussion refresh from the API after a write. Live vote and reply sockets were not added. A new socket room would need the same authorization review as chat, and correctness mattered more than instant updates.

## Preservation and migration

No migration runs on startup or on the first request. Legacy `communityMessages` and `communityRooms` are untouched. Old chat URLs now open the question feed because the chat page was replaced. The chat APIs still exist for any caller that already uses them.

Chart attachments are not on the composer. The current uploader only stores a file by inserting a level-room chat message.

## Files changed

- `lib/community-qa.js`, `lib/community-qa.d.ts`, `lib/community-qa-store.ts`
- `pages/api/community/questions/**`
- `pages/community.tsx`, `pages/community/ask.tsx`, `pages/community/questions/[id].tsx`
- `components/community/CommunityShell.tsx`, `components/community/VoteControl.tsx`
- `tests/community-qa.test.js`, `package.json` test script
- `scripts/community-qa-indexes.js`
- `pages/index.tsx` community card sentence, so it no longer describes level chat rooms
- this audit

## Checks

- `node --test tests/community-qa.test.js`: 15 passed. These tests do not open MongoDB.
- `npm test`: 204 passed, 0 failed. This is the existing unit suite plus the Q&A rules. It is not a database integration run and not a browser end-to-end run.
- `npx tsc --noEmit`: exit 0.
- ESLint on the new community pages, components, store, and question APIs: exit 0.
- `node --check` on `lib/community-qa.js` and `scripts/community-qa-indexes.js`: exit 0.
- No production build. A dev server may be using `.next`, so a build was not started.
- Browser layout, keyboard use, and responsive behavior were not verified. There was no browser session for this change.

## Remaining risks

- Without the unique vote index, two simultaneous first votes from the same user can both insert. The read path keeps the latest vote, and a later vote collapses extras, but the score increment can be wrong until the next successful vote. Approve and create the index before relying on votes under concurrency.
- The rate limit is per process.
- My Activity includes at most the 200 newest replies by that member, plus questions they authored.
- Two different accounts can still vote for each other. Self-votes are blocked.
- Discussion pages do not update live.
- Browser layout was not verified in this session.
- A production build was not run, so an active dev server would not have its `.next` output replaced.
- Release remains blocked for the reasons already recorded outside this community change.
