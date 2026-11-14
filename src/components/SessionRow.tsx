import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ChatSession } from "../api/tron";
import { useI18n } from "../i18n";
import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from "../theme";
import { formatRelativeTime } from "../utils/format";
import { Ionicons } from "./icons";

interface SessionRowProps {
  session: ChatSession;
  onPress: () => void;
  active?: boolean;
  compact?: boolean;
}

export function SessionRow({
  session,
  onPress,
  active = false,
  compact = false,
}: SessionRowProps) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { t, format } = useI18n();
  const title = session.title?.trim() || t("未命名会话");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={format("打开会话：{title}", { title })}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.root,
        compact && styles.compact,
        active && styles.active,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.iconWrap}>
        <Ionicons
          name="chatbubble-ellipses-outline"
          size={16}
          color={active ? palette.accent : palette.muted}
        />
      </View>
      <View style={styles.body}>
        <Text
          style={[styles.title, active && { color: palette.accent }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {formatRelativeTime(session.updatedAt)}
          {session.lastRunStatus
            ? ` · ${runStatusLabel(session.lastRunStatus, t)}`
            : ""}
        </Text>
      </View>
      {active ? (
        <View style={styles.activeDot} />
      ) : (
        <Ionicons name="chevron-forward" size={14} color={palette.border} />
      )}
    </Pressable>
  );
}

function runStatusLabel(
  status: string,
  t: (source: string) => string,
): string {
  const normalized = status.toUpperCase();
  if (normalized === "RUNNING" || normalized === "IN_PROGRESS") {
    return t("运行中");
  }
  if (normalized === "FAILED" || normalized === "ERROR") {
    return t("运行失败");
  }
  if (normalized === "COMPLETED" || normalized === "SUCCEEDED") {
    return t("已完成");
  }
  return status;
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      borderRadius: radius.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "transparent",
      minHeight: 58,
    },
    compact: {
      paddingVertical: spacing.sm,
      minHeight: 52,
    },
    active: {
      backgroundColor: c.accentSoft,
      borderColor: c.accentBorder,
    },
    pressed: {
      backgroundColor: c.surfaceAlt,
    },
    iconWrap: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    body: {
      flex: 1,
      gap: 3,
    },
    title: {
      color: c.text,
      ...typography.bodyStrong,
      fontSize: 14,
    },
    meta: {
      color: c.muted,
      ...typography.caption,
      fontSize: 11,
    },
    activeDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: c.accent,
    },
  });