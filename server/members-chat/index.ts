import { MEMBERS_CHAT_DIR } from "../persistence/paths.ts";
import { createMembersChatStore } from "./store.ts";

export const membersChatStore = createMembersChatStore(MEMBERS_CHAT_DIR);

export {
  createMembersChatStore,
  MembersChatError,
  MEMBERS_CHAT_DEFAULT_PAGE,
  MEMBERS_CHAT_MAX_CHARS,
  MEMBERS_CHAT_MAX_PAGE,
  monthKey,
  monthOfId,
  type MembersChatPage,
  type MembersChatStore,
  type PostInput,
} from "./store.ts";
