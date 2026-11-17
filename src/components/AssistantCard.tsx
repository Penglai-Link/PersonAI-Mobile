import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { Assistant } from "../api/tron";
import { useI18n } from "../i18n";
import {
  radius,
  spacing,
  typography,
  useTheme,
  useThemedStyles,
  type Palette,
} from "../theme";
import { Badge } from "./Badge";
import { Ionicons } from "./icons";

interface AssistantCardProps {
  assistant: Assistant;
  opening: boolean;
  onPress: () => void;
  /** Node/product context when the dashboard aggregates multiple nodes. */
  context?: string;
}

export function AssistantCard({
  assistant,
  opening,
  onPress,
  context,
}: AssistantCardProps) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { t } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${assistant.name}${
        assistant.isMain ? t("，默认个人助手") : ""
      }`}
      accessibilityHint={
        assistant.enabled
          ? t("进入这个个人助手的会话")
          : t("该个人助手已停用")
      }
      accessibilityState={{ disabled: !assistant.enabled, busy: opening }}
      disabled={!assistant.enabled || opening}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        assistant.isMain && styles.cardMain,
        !assistant.enabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.topRow}>
        <View style={styles.avatar}>
          <Ionicons name="sparkles" size={16} color={palette.accent} />
        </View>
        <View style={styles.badges}>
          {assistant.isMain ? (
            <Badge label={t("默认个人助手")} tone="accent" />
          ) : null}
          {!assistant.enabled ? <Badge label={t("已停用")} tone="danger" /> : null}
        </View>
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {assistant.name}
      </Text>
      {context ? (
        <Text style={styles.context} numberOfLines={1}>
          {context}
        </Text>
      ) : null}
      <Text style={styles.description} numberOfLines={3}>
        {assistant.description?.trim() || t("这个个人助手还没有描述。")}
      </Text>
      <View style={styles.footer}>
        <Text style={styles.footerText} numberOfLines={1}>
          {assistant.enabled ? t("进入会话") : t("已停用")}
        </Text>
        {opening ? (
          <ActivityIndicator size="small" color={palette.accent} />
        ) : assistant.enabled ? (
          <Ionicons name="arrow-forward" size={14} color={palette.accent} />
        ) : null}
      </View>
    </Pressable>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      width: 200,
      minHeight: 172,
      padding: spacing.lg,
      borderRadius: radius.card,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      gap: spacing.sm,
    },
    cardMain: {
      borderColor: c.accentBorder,
      backgroundColor: c.surfaceAlt,
    },
    disabled: {
      opacity: 0.65,
    },
    pressed: {
      opacity: 0.75,
    },
    topRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      minHeight: 28,
    },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.accentSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.accentBorder,
    },
    badges: {
      flexDirection: "row",
      gap: spacing.xs,
      flexShrink: 1,
    },
    name: {
      color: c.text,
      ...typography.bodyStrong,
      fontSize: 16,
    },
    context: {
      color: c.muted,
      ...typography.caption,
      fontSize: 10,
      marginTop: -4,
    },
    description: {
      flex: 1,
      color: c.muted,
      ...typography.caption,
      lineHeight: 17,
    },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      paddingTop: spacing.sm,
    },
    footerText: {
      color: c.muted,
      ...typography.caption,
      fontSize: 11,
    },
  });