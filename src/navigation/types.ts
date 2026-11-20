import type { ChatSession } from "../api/tron";

export type AddNodeMode = "scan" | "manual";

/**
 * A chat draft is navigation state only. Like Tron's `draftCode`, it carries
 * the workspace and group context, and the node creates the real session when
 * the first message is sent.
 */
export interface ChatDraft {
  /** Local id that distinguishes consecutive drafts of the same route. */
  draftCode: string;
  workspaceCode: string;
  /** Topic context of the group the draft was opened from. */
  projectCode?: string | null;
  /** Directory context of the group the draft was opened from. */
  directoryCode?: string | null;
}

export type RootStackParamList = {
  /** Default home screen: product/node/session overview. */
  Dashboard: undefined;
  /** Saved nodes (computers) of one product. */
  Nodes: { productCode: string };
  AddNode: { productCode: string; mode?: AddNodeMode };
  Home: undefined;
  Chat: {
    /** Existing session. Absent for a draft that has not been sent yet. */
    session?: ChatSession;
    /** Local draft; sending the first message creates the session. */
    draft?: ChatDraft;
    workspaceCode: string;
    /** Workspace display name, shown as a tag on the session title. */
    workspaceLabel?: string | null;
    assistantCode?: string | null;
    assistantName?: string | null;
  };
  /** Mobile theme, language and product definitions. */
  Settings: undefined;
};