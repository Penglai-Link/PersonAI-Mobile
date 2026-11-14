import type { ChatSession } from "../api/tron";

export type AddNodeMode = "scan" | "manual";

export type RootStackParamList = {
  /** Default home screen: product/node/session overview. */
  Dashboard: undefined;
  /** Product picker and node-management entry point. */
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
  /** Mobile theme, language and product definitions. */
  Settings: undefined;
};