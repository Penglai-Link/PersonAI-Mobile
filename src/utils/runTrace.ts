import { toolResultIsError } from "@personai/agent-ui-chat-core/headless";
import type { AgUiEvent } from "../api/rpc";

export type RunTraceStatus = "running" | "completed" | "failed";
export type RunToolStatus = "running" | "completed" | "failed";

export interface RunToolTrace {
  id: string;
  toolCallId: string;
  name: string;
  args: unknown;
  argsText: string;
  result: string;
  status: RunToolStatus;
  startedAt: number;
  endedAt: number | null;
}

export interface RunTrace {
  runId: string;
  startedAt: number;
  finishedAt: number | null;
  status: RunTraceStatus;
  tools: RunToolTrace[];
  reasoning: string;
  error: string | null;
}

function eventType(event: AgUiEvent): string {
  return typeof event.type === "string" ? event.type.toUpperCase() : "";
}

function eventTime(event: AgUiEvent): number {
  return typeof event.timestamp === "number" ? event.timestamp : Date.now();
}

function eventRunId(event: AgUiEvent): string | null {
  return typeof event.runId === "string" && event.runId.trim()
    ? event.runId
    : null;
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function toolStatusFromResult(
  content: string,
  event: AgUiEvent,
  toolName: string,
): RunToolStatus {
  // Gateway envelopes describe dispatch, not the inner tool. The Web rail
  // presents the inner call, so a rejected envelope must not turn its card
  // into a failure — the inner call owns that status.
  if (toolName.trim().toLowerCase() === "tool_execute") return "completed";
  // Match the Web card: only a top-level `isError` turns the call into a
  // failure. Nested `isError` flags belong to inner structured data.
  if (event.isError === true) return "failed";
  return toolResultIsError(content) ? "failed" : "completed";
}

function updateTool(
  trace: RunTrace,
  toolCallId: string,
  update: (tool: RunToolTrace) => RunToolTrace,
): RunTrace {
  let found = false;
  const tools = trace.tools.map((tool) => {
    if (tool.toolCallId !== toolCallId) return tool;
    found = true;
    return update(tool);
  });
  if (!found) {
    const tool: RunToolTrace = {
      id: toolCallId,
      toolCallId,
      name: "",
      args: undefined,
      argsText: "",
      result: "",
      status: "running",
      startedAt: eventTimeFromTrace(trace),
      endedAt: null,
    };
    tools.push(update(tool));
  }
  return { ...trace, tools };
}

function eventTimeFromTrace(trace: RunTrace): number {
  return trace.finishedAt ?? trace.startedAt;
}

/**
 * Folds one AG-UI event into the current run trace. Text deltas are handled by
 * the chat screen; this only tracks reasoning, tools and run lifecycle. Returns
 * the previous trace unchanged when the event belongs to another run or carries
 * nothing for the process view, so React can bail out of the render.
 */
export function reduceRunTrace(
  current: RunTrace | null,
  event: AgUiEvent,
): RunTrace | null {
  const type = eventType(event);
  const runId = eventRunId(event);

  if (type === "RUN_STARTED") {
    if (!runId) return current;
    return {
      runId,
      startedAt: eventTime(event),
      finishedAt: null,
      status: "running",
      tools: [],
      reasoning: "",
      error: null,
    };
  }

  if (!current || (runId && current.runId !== runId)) return current;

  if (type === "RUN_FINISHED") {
    return {
      ...current,
      status: "completed",
      finishedAt: eventTime(event),
      tools: current.tools.map((tool) =>
        tool.status === "running"
          ? { ...tool, status: "completed", endedAt: eventTime(event) }
          : tool,
      ),
    };
  }

  if (type === "RUN_ERROR") {
    const message =
      typeof event.message === "string" && event.message.trim()
        ? event.message
        : typeof event.code === "string" && event.code.trim()
          ? event.code
          : "RUN_ERROR";
    return {
      ...current,
      status: "failed",
      finishedAt: eventTime(event),
      error: message,
      tools: current.tools.map((tool) =>
        tool.status === "running"
          ? { ...tool, status: "failed", endedAt: eventTime(event) }
          : tool,
      ),
    };
  }

  // `REASONING_MESSAGE_CONTENT` is the user-facing summary. Raw provider
  // reasoning (`REASONING_TEXT_CONTENT`) stays out of the transcript.
  if (type === "REASONING_MESSAGE_CONTENT") {
    const delta = typeof event.delta === "string" ? event.delta : "";
    if (!delta) return current;
    const reasoning = `${current.reasoning}${delta}`;
    return {
      ...current,
      reasoning: reasoning.length > 4000 ? reasoning.slice(-4000) : reasoning,
    };
  }

  if (type === "TOOL_CALL_START") {
    const toolCallId =
      typeof event.toolCallId === "string" ? event.toolCallId : null;
    if (!toolCallId) return current;
    const name =
      typeof event.toolCallName === "string" ? event.toolCallName : "";
    const initialArgs = event.toolCallArgs;
    return {
      ...current,
      tools: [
        ...current.tools.filter((tool) => tool.toolCallId !== toolCallId),
        {
          id: toolCallId,
          toolCallId,
          name,
          args: initialArgs,
          argsText:
            typeof initialArgs === "string" ? initialArgs : "",
          result: "",
          status: "running",
          startedAt: eventTime(event),
          endedAt: null,
        },
      ],
    };
  }

  if (type === "TOOL_CALL_ARGS") {
    const toolCallId =
      typeof event.toolCallId === "string" ? event.toolCallId : null;
    if (!toolCallId) return current;
    const delta =
      typeof event.delta === "string"
        ? event.delta
        : event.toolCallArgs !== undefined
          ? textValue(event.toolCallArgs)
          : "";
    return updateTool(current, toolCallId, (tool) => {
      const argsText = `${tool.argsText}${delta}`;
      const parsed = parseJson(argsText);
      return {
        ...tool,
        argsText,
        args: parsed === undefined ? tool.args : parsed,
      };
    });
  }

  if (type === "TOOL_CALL_END") {
    const toolCallId =
      typeof event.toolCallId === "string" ? event.toolCallId : null;
    if (!toolCallId) return current;
    const endedAt = eventTime(event);
    return updateTool(current, toolCallId, (tool) => {
      const parsed = parseJson(tool.argsText);
      return {
        ...tool,
        args: parsed === undefined ? tool.args : parsed,
        status: tool.status === "failed" ? "failed" : "completed",
        endedAt,
      };
    });
  }

  if (type === "TOOL_CALL_RESULT") {
    const toolCallId =
      typeof event.toolCallId === "string" ? event.toolCallId : null;
    if (!toolCallId) return current;
    const result =
      typeof event.content === "string"
        ? event.content
        : event.result !== undefined
          ? textValue(event.result)
          : "";
    const endedAt = eventTime(event);
    return updateTool(current, toolCallId, (tool) => ({
      ...tool,
      result,
      status: toolStatusFromResult(result, event, tool.name),
      endedAt,
    }));
  }

  return current;
}

/** Rebuilds one trace per run from a replayed protocol event list. */
export function buildRunTraces(events: AgUiEvent[]): Map<string, RunTrace> {
  const traces = new Map<string, RunTrace>();
  let current: RunTrace | null = null;
  for (const event of events) {
    current = reduceRunTrace(current, event);
    if (current) traces.set(current.runId, current);
  }
  return traces;
}
