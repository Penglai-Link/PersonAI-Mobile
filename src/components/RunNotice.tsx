import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  chatErrorPresentation,
  type AguiRunNotice,
} from "@personai/agent-ui-chat-core/headless";

import {
  radius,
  spacing,
  typography,
  useTheme,
  useThemedStyles,
  type Palette,
} from "../theme";
import { Ionicons } from "./icons";

/**
 * Labels for the run-lifecycle notices. The copy mirrors the work rail of
 * `chat-react`/`chat-vue` (`AguiRunStatus` / `AguiRunNotices.vue`) so a failed
 * turn reads the same on every client.
 */
export interface RunNoticeLabels {
  failed: string;
  stopped: string;
  mcpUnavailable: string;
  presentationIncomplete: string;
  presentationIncompleteDetail: string;
  compactionRequested: string;
  compactionStarted: string;
  compactionCompleted: string;
  compactionFailed: string;
  compactionInterrupted: string;
  toolSchemaOverBudget: string;
  toolSchemaBudget: (
    estimatedTokens: number,
    limitTokens: number,
    toolCount: number,
  ) => string;
  toolSchemaBudgetHint: string;
  details: string;
}

interface RunNoticeProps {
  notices: AguiRunNotice[];
  labels: RunNoticeLabels;
  /** Borderless rows, for notices that belong to an existing process card. */
  plain?: boolean;
}

function compactionTitle(
  status: Extract<AguiRunNotice, { kind: "compaction" }>["status"],
  labels: RunNoticeLabels,
): string {
  switch (status) {
    case "requested":
      return labels.compactionRequested;
    case "started":
      return labels.compactionStarted;
    case "completed":
      return labels.compactionCompleted;
    case "failed":
      return labels.compactionFailed;
    default:
      return labels.compactionInterrupted;
  }
}

function NoticeRow({
  notice,
  labels,
  plain,
}: {
  notice: AguiRunNotice;
  labels: RunNoticeLabels;
  plain?: boolean;
}) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [showDetails, setShowDetails] = useState(false);

  let failed = true;
  let title = labels.failed;
  let detail = "";
  let hint = "";
  let pending = false;

  if (notice.kind === "compaction") {
    title = compactionTitle(notice.status, labels);
    failed = notice.status === "failed";
    pending = notice.status === "requested" || notice.status === "started";
  } else if (notice.kind === "integrationWarning") {
    title = labels.mcpUnavailable;
    failed = false;
    detail = notice.message || notice.code;
  } else if (notice.kind === "runStopped") {
    title = labels.stopped;
    failed = false;
    detail = notice.message;
  } else {
    title = labels.failed;
    detail = notice.message || notice.code;
    if (notice.code === "AGENT_AGUI_REPLAY_INCOMPLETE") {
      title = labels.presentationIncomplete;
      detail = labels.presentationIncompleteDetail;
    } else if (notice.code.toLowerCase() === "tool_schema_over_budget") {
      title = labels.toolSchemaOverBudget;
      const budget = notice.toolSchemaBudget;
      detail = budget
        ? labels.toolSchemaBudget(
            budget.estimatedTokens,
            budget.limitTokens,
            budget.toolCount,
          )
        : "";
      hint = labels.toolSchemaBudgetHint;
    }
  }

  // Provider diagnostics stay available without becoming the primary copy.
  const presentation = detail
    ? chatErrorPresentation(
        detail,
        labels.failed,
        notice.kind === "runError" || notice.kind === "runStopped"
          ? notice.code
          : undefined,
      )
    : { summary: "", details: "" };
  const color = failed ? palette.danger : palette.muted;

  return (
    <View
      style={[
        styles.notice,
        plain
          ? styles.noticePlain
          : failed
            ? styles.noticeFailed
            : styles.noticeNeutral,
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Ionicons
        name={pending ? "sync-outline" : failed ? "alert-circle-outline" : "stop-circle-outline"}
        size={16}
        color={color}
      />
      <View style={styles.content}>
        <Text style={[styles.title, { color: failed ? palette.danger : palette.text }]}>
          {title}
        </Text>
        {presentation.summary ? (
          <Text style={styles.summary}>{presentation.summary}</Text>
        ) : null}
        {presentation.details ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showDetails }}
            onPress={() => setShowDetails((value) => !value)}
            style={({ pressed }) => [styles.detailsToggle, pressed && styles.pressed]}
          >
            <Text style={styles.detailsToggleText}>{labels.details}</Text>
            <Ionicons
              name={showDetails ? "chevron-up" : "chevron-down"}
              size={12}
              color={palette.muted}
            />
          </Pressable>
        ) : null}
        {presentation.details && showDetails ? (
          <Text selectable style={styles.detailsText}>
            {presentation.details}
          </Text>
        ) : null}
        {hint ? <Text style={styles.summary}>{hint}</Text> : null}
      </View>
    </View>
  );
}

/** Run lifecycle notices (`runError`, `runStopped`, compaction, MCP warning). */
export function RunNotice({ notices, labels, plain = false }: RunNoticeProps) {
  const styles = useThemedStyles(createStyles);
  if (!notices.length) return null;
  return (
    <View style={styles.stack}>
      {notices.map((notice, index) => (
        <NoticeRow
          key={`${notice.kind}:${index}`}
          notice={notice}
          labels={labels}
          plain={plain}
        />
      ))}
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    stack: {
      gap: spacing.sm,
    },
    notice: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderRadius: radius.control,
      borderWidth: StyleSheet.hairlineWidth,
    },
    noticeFailed: {
      backgroundColor: c.dangerSoft,
      borderColor: c.dangerBorder,
    },
    noticePlain: {
      backgroundColor: "transparent",
      borderColor: "transparent",
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.xs,
    },
    noticeNeutral: {
      backgroundColor: c.surface,
      borderColor: c.border,
    },
    content: {
      flex: 1,
      gap: 2,
    },
    title: {
      ...typography.caption,
      fontWeight: "600",
    },
    summary: {
      color: c.muted,
      ...typography.caption,
      lineHeight: 18,
    },
    detailsToggle: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingVertical: 2,
    },
    detailsToggleText: {
      color: c.muted,
      ...typography.caption,
      fontWeight: "600",
    },
    detailsText: {
      color: c.muted,
      ...typography.caption,
      fontFamily: "Menlo",
      fontSize: 10,
      lineHeight: 15,
    },
    pressed: {
      opacity: 0.7,
    },
  });