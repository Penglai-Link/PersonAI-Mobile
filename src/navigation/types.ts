import type { ChatSession } from "../api/tron";

export type AddNodeMode = "scan" | "manual";

export type RootStackParamList = {
  /** Product picker — the mobile home screen. */
  Products: undefined;
  /** Saved nodes (computers) of one product. */
  Nodes: { productCode: string };
  AddNode: { productCode: string; mode?: AddNodeMode };
  Home: undefined;
  Chat: {
    session: ChatSession;
    workspaceCode: string;
    dudeCode?: string | null;
    dudeName?: string | null;
  };
  /** Skin + light/dark preferences. */
  Appearance: undefined;
};