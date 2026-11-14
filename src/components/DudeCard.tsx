import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { Dude } from "../api/tron";
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

interface DudeCardProps {
  dude: Dude;
  opening: boolean;
  onPress: () => void;
  /** Node/product context when the dashboard aggregates multiple nodes. */
  context?: string;
}

export function DudeCard({
  dude,
  opening,
  onPress,
  context,
}: DudeCardProps) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { t } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${dude.name}${dude.isMain ? t("，主 Dude") : ""}`}
      accessibilityHint={
        dude.enabled ? t("进入这个 Dude 的会话") : t("该 Dude 已停用")
      }
      accessibilityState={{ disabled: !dude.enabled, busy: opening }}
      disabled={!dude.enabled || opening}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        dude.isMain && styles.cardMain,
        !dude.enabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.topRow}>
        <View style={styles.avatar}>
          <Ionicons name="sparkles" size={16} color={palette.accent} />
        </View>
        <View style={styles.badges}>
          {dude.isMain ? <Badge label={t("主 Dude")} tone="accent" /> : null}
          {!dude.enabled ? <Badge label={t("已停用")} tone="danger" /> : null}
        </View>
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {dude.name}
      </Text>
      {context ? (
        <Text style={styles.context} numberOfLines={1}>
          {context}
        </Text>
      ) : null}
      <Text style={styles.description} numberOfLines={3}>
        {dude.description?.trim() || t("这个 Dude 还没有描述。")}
      </Text>
      <View style={styles.footer}>
        <Text style={styles.footerText} numberOfLines={1}>
          {dude.enabled ? t("进入会话") : t("已停用")}
        </Text>
        {opening ? (
          <ActivityIndicator size="small" color={palette.accent} />
        ) : dude.enabled ? (
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