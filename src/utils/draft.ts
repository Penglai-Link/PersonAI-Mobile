/**
 * Local id for a chat draft. A draft is only navigation state: the node creates
 * the real session when the first message is sent, mirroring Tron's `draftCode`.
 */
export function createDraftCode(): string {
  return `draft-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}