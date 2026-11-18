import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { DirectoryRecord } from "../api/tron";
import {
  radius,
  spacing,
  typography,
  useTheme,
  useThemedStyles,
  type Palette,
} from "../theme";
import { Ionicons } from "./icons";

export interface WorkspaceSelectorLabels {
  ariaLabel: string;
  noDirectory: string;
  workspaceFallback: string;
  loading: string;
  loadFailed: string;
  retry: string;
  unavailable: string;
  close: string;
  pickTitle: string;
  empty: string;
  addHint: string;
}

interface WorkspaceSelectorProps {
  /** Directory the session is pinned to by its group; selection is locked then. */
  fixedDirectoryCode: string | null;
  /** Directory currently used by the run (`null` = workspace default). */
  currentDirectoryCode: string | null;
  directories: DirectoryRecord[];
  loading: boolean;
  failed: boolean;
  /** Workspace name shown when no directory is selected. */
  workspaceLabel: string | null;
  disabled?: boolean;
  onChange: (directoryCode: string | null) => Promise<void> | void;
  onRetry: () => void;
  labels: WorkspaceSelectorLabels;
}

/**
 * Composer-top control mirroring the desktop `ChatWorkingDirectoryControl`:
 * a folder + current workspace/directory name, with a list of the workspace's
 * directories. Sessions created from a directory group are pinned to it, so
 * there the control is read-only — exactly like the desktop.
 */
export function WorkspaceSelector({
  fixedDirectoryCode,
  currentDirectoryCode,
  directories,
  loading,
  failed,
  workspaceLabel,
  disabled = false,
  onChange,
  onRetry,
  labels,
}: WorkspaceSelectorProps) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheetMaxHeight = Math.round(windowHeight * 0.72);
  const listMaxHeight = Math.max(200, sheetMaxHeight - 150);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const current = useMemo(
    () =>
      directories.find(
        (directory) =>
          directory.directoryCode ===
          (fixedDirectoryCode ?? currentDirectoryCode),
      ) ?? null,
    [currentDirectoryCode, directories, fixedDirectoryCode],
  );

  const locked = Boolean(fixedDirectoryCode) || disabled;
  const label =
    current?.name?.trim() ||
    (fixedDirectoryCode || currentDirectoryCode
      ? labels.unavailable
      : workspaceLabel?.trim() || labels.noDirectory);

  useEffect(() => {
    if (!open) return;
    if (failed) onRetry();
    // Retry once each time the sheet opens on a failed list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const select = useCallback(
    async (directoryCode: string | null) => {
      if (pending) return;
      if (directoryCode === (fixedDirectoryCode ?? currentDirectoryCode)) {
        setOpen(false);
        return;
      }
      setPending(true);
      try {
        await onChange(directoryCode);
        setOpen(false);
      } finally {
        setPending(false);
      }
    },
    [currentDirectoryCode, fixedDirectoryCode, onChange, pending],
  );

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={labels.ariaLabel}
        accessibilityState={{ disabled: locked, expanded: open }}
        disabled={locked}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.trigger,
          locked && styles.triggerLocked,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons
          name={current ? "folder-outline" : "folder-open-outline"}
          size={13}
          color={palette.muted}
        />
        <Text style={styles.triggerLabel} numberOfLines={1}>
          {label}
        </Text>
        {locked ? null : (
          <Ionicons name="chevron-down" size={12} color={palette.muted} />
        )}
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.close}
          onPress={() => setOpen(false)}
          style={styles.backdrop}
        />
        <View style={[styles.sheet, { maxHeight: sheetMaxHeight }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{labels.pickTitle}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={labels.close}
              hitSlop={8}
              onPress={() => setOpen(false)}
            >
              <Ionicons name="close" size={18} color={palette.muted} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={[styles.sheetBody, { paddingBottom: spacing.xl + insets.bottom }]}
            style={[styles.sheetScroll, { maxHeight: listMaxHeight }]}
          >
            {loading && !directories.length ? (
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color={palette.muted} />
                <Text style={styles.statusText}>{labels.loading}</Text>
              </View>
            ) : null}
            {failed ? (
              <Pressable
                accessibilityRole="button"
                onPress={onRetry}
                style={({ pressed }) => [styles.statusRow, pressed && styles.pressed]}
              >
                <Ionicons name="refresh" size={14} color={palette.danger} />
                <Text style={[styles.statusText, { color: palette.danger }]}>
                  {labels.loadFailed} · {labels.retry}
                </Text>
              </Pressable>
            ) : null}
            {directories.map((directory) => {
              const selected = directory.directoryCode === currentDirectoryCode;
              return (
                <Pressable
                  key={directory.directoryCode}
                  accessibilityRole="radio"
                  accessibilityState={{
                    checked: selected,
                    disabled: pending || !directory.available,
                  }}
                  disabled={pending || !directory.available}
                  onPress={() => void select(directory.directoryCode)}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons
                    name="folder-outline"
                    size={15}
                    color={selected ? palette.accent : palette.muted}
                  />
                  <View style={styles.rowText}>
                    <Text
                      style={[
                        styles.rowLabel,
                        selected && { color: palette.accent },
                        !directory.available && styles.unavailable,
                      ]}
                      numberOfLines={1}
                    >
                      {directory.name}
                    </Text>
                    <Text style={styles.rowPath} numberOfLines={1}>
                      {directory.path || directory.directoryCode}
                    </Text>
                  </View>
                  {!directory.available ? (
                    <Text style={styles.rowMeta}>{labels.unavailable}</Text>
                  ) : selected ? (
                    <Ionicons name="checkmark" size={15} color={palette.accent} />
                  ) : null}
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{
                checked: !currentDirectoryCode,
                disabled: pending,
              }}
              disabled={pending}
              onPress={() => void select(null)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Ionicons name="folder-outline" size={15} color={palette.muted} />
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{labels.noDirectory}</Text>
              </View>
              {!currentDirectoryCode ? (
                <Ionicons name="checkmark" size={15} color={palette.accent} />
              ) : null}
            </Pressable>
            {directories.length === 0 && !loading && !failed ? (
              <Text style={styles.hint}>{labels.empty}</Text>
            ) : null}
            <Text style={styles.hint}>{labels.addHint}</Text>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    trigger: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      maxWidth: "100%",
      minHeight: 28,
      paddingHorizontal: spacing.xs,
      borderRadius: radius.control,
    },
    triggerLocked: {
      opacity: 0.85,
    },
    triggerLabel: {
      flexShrink: 1,
      color: c.muted,
      ...typography.caption,
      fontSize: 11,
    },
    backdrop: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: c.scrim,
    },
    sheet: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: "72%",
      borderTopLeftRadius: radius.card,
      borderTopRightRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.background,
    },
    sheetScroll: {
      flexGrow: 0,
      flexShrink: 1,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
      borderBottomColor: c.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    sheetTitle: {
      color: c.text,
      ...typography.bodyStrong,
      fontSize: 14,
    },
    sheetBody: {
      padding: spacing.md,
      paddingBottom: spacing.xl,
      gap: 2,
    },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
    },
    statusText: {
      color: c.muted,
      ...typography.caption,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderRadius: radius.control,
    },
    rowText: {
      flex: 1,
      minWidth: 0,
    },
    rowLabel: {
      color: c.text,
      ...typography.caption,
      fontWeight: "600",
    },
    rowPath: {
      color: c.muted,
      ...typography.caption,
      fontSize: 10,
    },
    rowMeta: {
      color: c.muted,
      ...typography.caption,
      fontSize: 10,
    },
    unavailable: {
      color: c.muted,
    },
    hint: {
      color: c.muted,
      ...typography.caption,
      fontSize: 10,
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.sm,
    },
    pressed: {
      opacity: 0.7,
    },
  });