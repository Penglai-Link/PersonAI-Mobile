import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AppHeader } from "../components/AppHeader";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { InlineBanner } from "../components/InlineBanner";
import { Screen } from "../components/Screen";
import { SegmentedControl } from "../components/SegmentedControl";
import { Ionicons } from "../components/icons";
import type { RootStackParamList } from "../navigation/types";
import { useNodeSession } from "../store/nodeSession";
import {
  radius,
  spacing,
  typography,
  useTheme,
  useThemedStyles,
  type Palette,
  type ResolvedMode,
  type Skin,
  type ThemeMode,
} from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Appearance">;

const modeOptions: ReadonlyArray<{ value: ThemeMode; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

export function AppearanceScreen({ navigation }: Props) {
  const { palette, mode, setMode,
    resolvedMode,
    skins,
    skinId,
    activeSkin,
    setSkinId,
    refreshSkins,
    loadingSkins,
    skinsError,
  } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { status: sessionStatus, currentNode, identity } = useNodeSession();

  useFocusEffect(
    useCallback(() => {
      if (sessionStatus === "online") {
        void refreshSkins();
      }
    }, [refreshSkins, sessionStatus]),
  );

  const nodeLabel = currentNode?.name ?? identity?.machineName ?? "当前节点";
  const online = sessionStatus === "online";

  return (
    <Screen>
      <AppHeader
        eyebrow="外观"
        title="主题与皮肤"
        subtitle="本地偏好，不会修改电脑端主题"
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Card style={styles.previewCard}>
          <View style={styles.previewHeader}>
            <Text style={styles.previewTitle}>
              {activeSkin ? activeSkin.name : "PersonAI 默认"}
            </Text>
            <Badge
              label={resolvedMode === "dark" ? "深色" : "浅色"}
              tone="accent"
            />
          </View>
          <View style={styles.swatchRow}>
            <SwatchPalette />
          </View>
          <Text style={styles.previewHint}>
            {activeSkin
              ? `皮肤来自「${nodeLabel}」，颜色变量已映射到移动端调色板。`
              : "尚未从节点读取皮肤，使用内置的深色/浅色调色板。"}
          </Text>
        </Card>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>明暗模式</Text>
          <SegmentedControl
            options={modeOptions}
            value={mode}
            onChange={setMode}
          />
          <Text style={styles.sectionHint}>
            跟随系统时使用设备的浅色/深色设置；切换后立即生效并保存到本机。
          </Text>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>节点皮肤</Text>
            {online ? (
              <Button
                label="刷新"
                icon="refresh"
                small
                variant="secondary"
                loading={loadingSkins}
                onPress={() => void refreshSkins()}
              />
            ) : null}
          </View>

          {skinsError ? <InlineBanner message={skinsError} /> : null}

          {!online ? (
            <EmptyState
              bare
              icon="cloud-offline-outline"
              title={currentNode ? "节点离线" : "未连接节点"}
              message={
                currentNode
                  ? "连接节点后才能读取该节点安装的皮肤。当前使用本机保存的模式与内置调色板。"
                  : "从产品列表进入某个节点后，才能读取该节点安装的皮肤。当前使用本机保存的模式与内置调色板。"
              }
            />
          ) : loadingSkins && !skins.length ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={palette.accent} />
              <Text style={styles.sectionHint}>正在读取节点皮肤…</Text>
            </View>
          ) : skins.length === 0 ? (
            <EmptyState
              bare
              icon="color-palette-outline"
              title="节点没有提供皮肤"
              message="电脑端可在“设置 → 外观”安装皮肤；移动端会自动读取。"
            />
          ) : (
            <View style={styles.skinList}>
              <SkinRow
                title="节点默认"
                subtitle="跟随节点当前激活的皮肤"
                selected={!skinId}
                onPress={() => setSkinId(null)}
              />
              {skins.map((skin) => (
                <SkinRow
                  key={skin.id}
                  title={skin.name}
                  subtitle={skin.id}
                  selected={skinId === skin.id}
                  skin={skin}
                  mode={resolvedMode}
                  onPress={() => setSkinId(skin.id)}
                />
              ))}
            </View>
          )}
        </View>

        <Text style={styles.footerNote}>
          只保存皮肤 id 与明暗模式；不会调用激活接口，也不会改变电脑端或其他设备的主题。
        </Text>
      </ScrollView>
    </Screen>
  );
}

function SwatchPalette() {
  const { palette } = useTheme();
  const colors = [
    palette.background,
    palette.surface,
    palette.surfaceAlt,
    palette.border,
    palette.accent,
    palette.onAccent,
    palette.danger,
    palette.success,
  ];
  return (
    <View style={swatchStyles.row}>
      {colors.map((color, index) => (
        <View
          key={`${color}-${index}`}
          style={[swatchStyles.swatch, { backgroundColor: color }]}
        />
      ))}
    </View>
  );
}

function SkinRow({
  title,
  subtitle,
  selected,
  skin,
  mode,
  onPress,
}: {
  title: string;
  subtitle: string;
  selected: boolean;
  skin?: Skin;
  mode?: ResolvedMode;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const variantColors = skin && mode
    ? mode === "dark"
      ? skin.variants.dark
      : skin.variants.light
    : null;
  const dots = variantColors
    ? [
        variantColors["--color-background"],
        variantColors["--color-primary"],
        variantColors["--color-on-surface"],
      ].filter((color): color is string => Boolean(color))
    : [];

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`选择主题 ${title}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.skinRow,
        selected && styles.skinRowSelected,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.skinSwatch}>
        {dots.length ? (
          dots.map((color, index) => (
            <View
              key={`${color}-${index}`}
              style={[styles.skinDot, { backgroundColor: color }]}
            />
          ))
        ) : (
          <Ionicons name="color-palette-outline" size={16} color={palette.accent} />
        )}
      </View>
      <View style={styles.skinText}>
        <Text style={styles.skinTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.skinSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {selected ? (
        <Ionicons name="checkmark-circle" size={20} color={palette.accent} />
      ) : (
        <Ionicons name="ellipse-outline" size={20} color={palette.border} />
      )}
    </Pressable>
  );
}

const swatchStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 6,
  },
  swatch: {
    flex: 1,
    height: 26,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(128, 128, 128, 0.35)",
  },
});

const createStyles = (c: Palette) =>
  StyleSheet.create({
    content: {
      paddingBottom: spacing.xxxl,
      gap: spacing.xl,
    },
    previewCard: {
      gap: spacing.md,
    },
    previewHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    previewTitle: {
      color: c.text,
      ...typography.section,
    },
    swatchRow: {
      width: "100%",
    },
    previewHint: {
      color: c.muted,
      ...typography.caption,
      lineHeight: 18,
    },
    section: {
      gap: spacing.md,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    sectionTitle: {
      color: c.text,
      ...typography.section,
    },
    sectionHint: {
      color: c.muted,
      ...typography.caption,
      lineHeight: 18,
    },
    loadingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.lg,
    },
    skinList: {
      gap: spacing.sm,
    },
    skinRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radius.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    skinRowSelected: {
      borderColor: c.accentBorder,
      backgroundColor: c.accentSoft,
    },
    pressed: {
      opacity: 0.75,
    },
    skinSwatch: {
      width: 42,
      height: 34,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 3,
      backgroundColor: c.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      overflow: "hidden",
    },
    skinDot: {
      width: 10,
      height: 18,
      borderRadius: 3,
    },
    skinText: {
      flex: 1,
      gap: 2,
      minWidth: 0,
    },
    skinTitle: {
      color: c.text,
      ...typography.bodyStrong,
      fontSize: 14,
    },
    skinSubtitle: {
      color: c.muted,
      ...typography.caption,
      fontSize: 11,
    },
    footerNote: {
      color: c.muted,
      ...typography.caption,
      fontSize: 11,
      lineHeight: 17,
      textAlign: "center",
      paddingHorizontal: spacing.lg,
    },
  });