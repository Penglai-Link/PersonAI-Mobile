import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ToolCard } from "@personai/agent-ui-chat-react-native";
import type { AguiRunNotice } from "@personai/agent-ui-chat-core/headless";

import { useI18n } from "../i18n";
import {
  radius,
  spacing,
  typography,
  useTheme,
  useThemedStyles,
  type Palette,
} from "../theme";
import { Ionicons } from "./icons";
import { RunNotice, type RunNoticeLabels } from "./RunNotice";
import type { RunToolTrace, RunTrace } from "../utils/runTrace";

interface RunProcessProps {
  trace: RunTrace;
  /** Live runs stay expanded; finished runs collapse to a summary. */
  live?: boolean;
  /** Lifecycle notices (failure/stop/compaction) of the same run. */
  notices?: AguiRunNotice[];
  noticeLabels: RunNoticeLabels;
}

function toolStatus(tool: RunToolTrace): "Running" | "Completed" | "Failed" {
  if (tool.status === "running") return "Running";
  if (tool.status === "failed") return "Failed";
  return "Completed";
}

export function RunProcess({
  trace,
  live = false,
  notices,
  noticeLabels,
}: RunProcessProps) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { t, format, language } = useI18n();
  const [expanded, setExpanded] = useState(live || trace.status === "failed");

  useEffect(() => {
    if (live || trace.status === "failed") setExpanded(true);
  }, [live, trace.status]);

  // Same source as the web work rail: lifecycle notices come from the run's
  // AG-UI events; a persisted trace without them still reports its error.
  const renderedNotices: AguiRunNotice[] = notices?.length
    ? notices
    : trace.status === "failed" && trace.error
      ? [{ kind: "runError", code: "", message: trace.error }]
      : [];
  const hasDetails =
    trace.tools.length > 0 || trace.reasoning.trim().length > 0;

  if (!live && !hasDetails) {
    // Nothing to expand: the run's lifecycle notice is the whole rail.
    return renderedNotices.length ? (
      <RunNotice labels={noticeLabels} notices={renderedNotices} />
    ) : null;
  }

  const toolCount = trace.tools.length;
  const summary = toolCount
    ? format("执行了 {count} 个工具", { count: toolCount })
    : trace.reasoning.trim()
      ? t("思考过程")
      : t("执行过程");

  const statusColor =
    trace.status === "failed"
      ? palette.danger
      : trace.status === "running"
        ? palette.accent
        : palette.muted;

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("执行过程")}
        accessibilityState={{ expanded: live || expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
      >
        {trace.status === "running" ? (
          <ActivityIndicator size="small" color={statusColor} />
        ) : (
          <Ionicons
            name={trace.status === "failed" ? "alert-circle-outline" : "checkmark-circle-outline"}
            size={16}
            color={statusColor}
          />
        )}
        <Text style={styles.title} numberOfLines={1}>
          {live ? t("正在执行…") : summary}
        </Text>
        {live ? (
          <Text style={styles.meta}>{summary}</Text>
        ) : (
          <Ionicons
            name={expanded ? "chevron-down" : "chevron-forward"}
            size={15}
            color={palette.muted}
          />
        )}
      </Pressable>

      {renderedNotices.length ? (
        <View style={styles.notices}>
          <RunNotice labels={noticeLabels} notices={renderedNotices} plain />
        </View>
      ) : null}

      {expanded && hasDetails ? (
        <View style={styles.body}>
          {trace.reasoning.trim() ? (
            <View style={styles.reasoning}>
              <Text style={styles.reasoningLabel}>{t("思考过程")}</Text>
              <Text style={styles.reasoningText} numberOfLines={8}>
                {trace.reasoning.trim()}
              </Text>
            </View>
          ) : null}
          {trace.tools.map((tool) => (
            <ToolCard
              key={tool.id}
              toolName={tool.name || "tool"}
              args={tool.args}
              result={tool.name === "tool_execute" ? "" : tool.result}
              status={toolStatus(tool)}
              locale={language}
              theme={{
                textColor: palette.text,
                mutedTextColor: palette.muted,
                surfaceColor: palette.surface,
                borderColor: palette.border,
                primaryColor: palette.accent,
                primaryTextColor: palette.onAccent,
                dangerColor: palette.danger,
                borderRadius: radius.card,
                spacing: spacing.md,
                panelColor: palette.background,
                userBubbleColor: palette.accent,
                userBubbleTextColor: palette.onAccent,
                assistantBubbleColor: palette.surface,
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    container: {
      marginTop: spacing.xs,
      marginBottom: spacing.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: radius.card,
      backgroundColor: c.surface,
      overflow: "hidden",
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    title: {
      flex: 1,
      color: c.text,
      ...typography.caption,
      fontWeight: "600",
    },
    meta: {
      color: c.muted,
      ...typography.caption,
    },
    notices: {
      paddingHorizontal: spacing.sm,
      paddingBottom: spacing.sm,
    },
    body: {
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingBottom: spacing.sm,
    },
    reasoning: {
      gap: 2,
      paddingHorizontal: spacing.xs,
    },
    reasoningLabel: {
      color: c.muted,
      ...typography.caption,
    },
    reasoningText: {
      color: c.muted,
      ...typography.caption,
      lineHeight: 18,
    },
    pressed: {
      opacity: 0.7,
    },
  });