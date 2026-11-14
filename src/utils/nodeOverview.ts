import {
  TRON_PRODUCT_CODE,
  listDirectories,
  listDudes,
  listProjects,
  listSessionGroups,
  listWorkspaceOptions,
  type ChatSession,
  type DirectoryRecord,
  type Dude,
  type ProjectRecord,
} from "../api/tron";
import type { SavedNode } from "../store/connections";
import type { NodeSessionContextValue } from "../store/nodeSession";

export type RequestForNode = NodeSessionContextValue["requestForNode"];

export interface NodeOverview {
  workspaceCode: string | null;
  sessions: ChatSession[];
  projects: ProjectRecord[];
  directories: DirectoryRecord[];
  dudes: Dude[];
}

function workspaceStatusActive(status: string): boolean {
  return status?.toUpperCase() === "ACTIVE";
}

function uniqueSessions(sessions: ChatSession[]): ChatSession[] {
  const byCode = new Map<string, ChatSession>();
  for (const session of sessions) {
    if (session?.sessionCode) byCode.set(session.sessionCode, session);
  }
  return [...byCode.values()];
}

/**
 * Reads the catalog for one node without changing the active node. Only the
 * first active workspace is loaded (current drawer/dashboard limitation).
 */
export async function loadNodeOverview(
  node: SavedNode,
  requestForNode: RequestForNode,
): Promise<NodeOverview> {
  return requestForNode<NodeOverview>(node, async ({ baseUrl, token }) => {
    const workspaces = await listWorkspaceOptions({ baseUrl, token });
    const activeWorkspaces = workspaces.filter((workspace) =>
      workspaceStatusActive(workspace.status),
    );
    const workspaceCode =
      activeWorkspaces[0]?.workspaceCode ??
      workspaces[0]?.workspaceCode ??
      null;
    if (!workspaceCode) {
      return {
        workspaceCode: null,
        sessions: [],
        projects: [],
        directories: [],
        dudes: [],
      };
    }

    const isTronProduct = node.productCode === TRON_PRODUCT_CODE;
    const [sessionGroups, projects, directories, dudes] = await Promise.all([
      listSessionGroups({ baseUrl, token, workspaceCode }),
      isTronProduct
        ? listProjects({ baseUrl, token, workspaceCode }).catch(() => [])
        : Promise.resolve([]),
      isTronProduct
        ? listDirectories({ baseUrl, token, workspaceCode }).catch(() => [])
        : Promise.resolve([]),
      listDudes({ baseUrl, token, workspaceCode }).catch(() => []),
    ]);

    return {
      workspaceCode,
      sessions: uniqueSessions(
        sessionGroups.flatMap((group) => group.sessions ?? []),
      ),
      projects,
      directories,
      dudes,
    };
  });
}
