import { StyleSheet, Text, View } from "react-native";

import { radius, spacing, typography, useThemedStyles, type Palette } from "../theme";

interface MessageBubbleProps {
  role: string;
  content: string;
  assistantName?: string | null;
  pending?: boolean;
}

export function MessageBubble({
  role,
  content,
  assistantName,
  pending = false,
}: MessageBubbleProps) {
  const styles = useThemedStyles(createStyles);
  const isUser = role === "USER";
  const showWaiting = pending && !content.trim();

  if (isUser) {
    return (
      <View style={styles.userRow}>
        <View style={[styles.bubble, styles.userBubble]}>
          <Text selectable style={[styles.userText, styles.text]}>
            {content}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.assistantRow}>
      <View style={styles.assistantMeta}>
        <View style={styles.assistantAvatar}>
          <Text style={styles.assistantAvatarText}>
            {(assistantName?.trim() || "T").slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.assistantName} numberOfLines={1}>
          {assistantName?.trim() || "Tron"}
        </Text>
      </View>
      <View style={[styles.bubble, styles.assistantBubble]}>
        {showWaiting ? (
          <Text style={styles.waiting}>正在思考…</Text>
        ) : (
          <Text selectable style={[styles.assistantText, styles.text]}>
            {content}
            {pending ? <Text style={styles.cursor}> ▍</Text> : null}
          </Text>
        )}
      </View>
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    userRow: {
      alignItems: "flex-end",
      marginBottom: spacing.md,
    },
    assistantRow: {
      alignItems: "flex-start",
      marginBottom: spacing.lg,
    },
    assistantMeta: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.xs,
      paddingLeft: 2,
    },
    assistantAvatar: {
      width: 20,
      height: 20,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.accentSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.accentBorder,
    },
    assistantAvatarText: {
      color: c.accent,
      fontSize: 10,
      fontWeight: "700",
    },
    assistantName: {
      color: c.muted,
      ...typography.caption,
      fontSize: 11,
    },
    bubble: {
      maxWidth: "86%",
      borderRadius: radius.card,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
    },
    userBubble: {
      backgroundColor: c.accent,
      borderColor: c.accent,
      borderBottomRightRadius: 4,
    },
    assistantBubble: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderBottomLeftRadius: 4,
    },
    text: {
      ...typography.body,
      lineHeight: 22,
    },
    userText: {
      color: c.onAccent,
    },
    assistantText: {
      color: c.text,
    },
    cursor: {
      color: c.accent,
    },
    waiting: {
      color: c.muted,
      ...typography.body,
      fontStyle: "italic",
    },
  });