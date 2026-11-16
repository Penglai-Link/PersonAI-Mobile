import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import {
  Alert,
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
import { InlineBanner } from "../components/InlineBanner";
import { Screen } from "../components/Screen";
import { StatusDot } from "../components/StatusDot";
import { SegmentedControl } from "../components/SegmentedControl";
import { Select } from "../components/Select";
import { TextField } from "../components/TextField";
import { Ionicons } from "../components/icons";
import { useI18n, type Language } from "../i18n";
import type { RootStackParamList } from "../navigation/types";
import { useConnections, type SavedNode } from "../store/connections";
import {
  radius,
  spacing,
  typography,
  useTheme,
  useThemedStyles,
  type Palette,
  type ThemeMode,
} from "../theme";
import { confirmDestructive } from "../utils/confirm";
import { describeError, formatNodeCount } from "../utils/format";

export function SettingsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { palette, mode, setMode, resolvedMode, themes, themeId, setThemeId } =
    useTheme();
  const { t, format, language, setLanguage } = useI18n();
  const styles = useThemedStyles(createStyles);
  const { products, nodes, addProduct, removeProduct, removeNode } =
    useConnections();

  const [showAdd, setShowAdd] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [expandedProducts, setExpandedProducts] = useState<
    Record<string, boolean>
  >({});

  const modeOptions: ReadonlyArray<{ value: ThemeMode; label: string }> = [
    { value: "system", label: t("跟随系统") },
    { value: "light", label: t("浅色") },
    { value: "dark", label: t("深色") },
  ];

  const languageOptions: ReadonlyArray<{ value: Language; label: string }> = [
    { value: "zh", label: "简体中文" },
    { value: "en", label: "English" },
  ];

  const toggleProduct = useCallback((productCode: string) => {
    setExpandedProducts((previous) => ({
      ...previous,
      [productCode]: previous[productCode] !== true,
    }));
  }, []);

  const removeNodeItem = useCallback(
    (node: SavedNode) => {
      confirmDestructive({
        title: t("删除节点"),
        message: format(
          "确定删除「{name}」？系统安全存储中的设备密钥也会被删除。",
          { name: node.name },
        ),
        onConfirm: () => {
          void removeNode(node.id).catch((error) => {
            Alert.alert(t("删除失败"), describeError(error));
          });
        },
      });
    },
    [format, removeNode, t],
  );

  const remove = useCallback(
    (product: { code: string; name: string; builtIn: boolean }) => {
      if (product.builtIn) return;
      confirmDestructive({
        title: t("删除产品"),
        message: format(
          "删除产品「{name}」？该产品下保存的节点和设备密钥也会一并删除。",
          { name: product.name },
        ),
        onConfirm: () => {
          void removeProduct(product.code).catch((error) => {
            Alert.alert(t("删除失败"), describeError(error));
          });
        },
      });
    },
    [format, removeProduct, t],
  );

  const submitProduct = useCallback(() => {
    setFormError(null);
    try {
      addProduct({ code, name });
      setCode("");
      setName("");
      setShowAdd(false);
    } catch (error) {
      setFormError(describeError(error));
    }
  }, [addProduct, code, name]);

  return (
    <Screen>
      <AppHeader
        title={t("设置")}
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Card style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Ionicons
              name="color-palette-outline"
              size={18}
              color={palette.accent}
            />
            <Text style={styles.cardTitle}>{t("外观与主题")}</Text>
          </View>

          <View style={styles.group}>
            <Text style={styles.groupLabel}>{t("明暗模式")}</Text>
            <SegmentedControl
              options={modeOptions}
              value={mode}
              onChange={setMode}
            />
          </View>

          <View style={styles.group}>
            <Text style={styles.groupLabel}>{t("主题色")}</Text>
            <View style={styles.themeGrid}>
              {themes.map((theme) => {
                const selected = theme.id === themeId;
                const accent = theme.accent[resolvedMode];
                return (
                  <Pressable
                    key={theme.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={theme.name[language]}
                    onPress={() => setThemeId(theme.id)}
                    style={({ pressed }) => [
                      styles.themeOption,
                      selected && {
                        borderColor: accent,
                        backgroundColor: palette.accentSoft,
                      },
                      pressed && styles.pressed,
                    ]}
                  >
                    <View
                      style={[styles.themeSwatch, { backgroundColor: accent }]}
                    />
                    <Text
                      style={[
                        styles.themeName,
                        selected && { color: palette.text },
                      ]}
                      numberOfLines={1}
                    >
                      {theme.name[language]}
                    </Text>
                    {selected ? (
                      <Ionicons
                        name="checkmark"
                        size={15}
                        color={accent}
                      />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </Card>

        <Card style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Ionicons name="language-outline" size={18} color={palette.accent} />
            <Text style={styles.cardTitle}>{t("界面语言")}</Text>
          </View>
          <Select
            value={language}
            options={languageOptions}
            onChange={setLanguage}
            accessibilityLabel={t("界面语言")}
            dismissLabel={t("关闭")}
          />
        </Card>

        <Card style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Ionicons name="cube-outline" size={18} color={palette.accent} />
            <Text style={styles.cardTitle}>{t("产品定义")}</Text>
            <View style={styles.cardTitleSpacer} />
            <Button
              label={showAdd ? t("取消") : t("添加产品")}
              icon={showAdd ? "close" : "add"}
              small
              variant={showAdd ? "secondary" : "primary"}
              onPress={() => {
                setShowAdd((value) => !value);
                setFormError(null);
              }}
            />
          </View>

          {showAdd ? (
            <View style={styles.form}>
              <TextField
                label={t("产品编码")}
                value={code}
                onChangeText={setCode}
                placeholder={t("例如 studio")}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TextField
                label={t("显示名")}
                value={name}
                onChangeText={setName}
                placeholder={t("例如 Tron Studio")}
                autoCapitalize="none"
              />
              {formError ? <InlineBanner message={formError} /> : null}
              <View style={styles.formActions}>
                <Button
                  label={t("保存")}
                  icon="checkmark"
                  onPress={submitProduct}
                  style={styles.formButton}
                />
                <Button
                  label={t("取消")}
                  variant="secondary"
                  onPress={() => {
                    setShowAdd(false);
                    setFormError(null);
                  }}
                  style={styles.formButton}
                />
              </View>
            </View>
          ) : null}

          <View style={styles.productList}>
            {products.map((product) => {
              const productNodes = nodes.filter(
                (node) => node.productCode === product.code,
              );
              const expanded = expandedProducts[product.code] === true;
              return (
                <View key={product.code} style={styles.productBlock}>
                  <View style={styles.productRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded }}
                      accessibilityLabel={format(
                        expanded
                          ? "收起产品：{name}"
                          : "展开产品：{name}",
                        { name: product.name },
                      )}
                      onPress={() => toggleProduct(product.code)}
                      style={({ pressed }) => [
                        styles.productMain,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.productIcon}>
                        <Ionicons
                          name="cube-outline"
                          size={16}
                          color={palette.muted}
                        />
                      </View>
                      <View style={styles.productText}>
                        <View style={styles.productNameRow}>
                          <Text style={styles.productName} numberOfLines={1}>
                            {product.name}
                          </Text>
                          {product.builtIn ? (
                            <Badge label={t("内置")} tone="accent" />
                          ) : null}
                        </View>
                        <Text style={styles.productMeta} numberOfLines={1}>
                          {product.code} ·{" "}
                          {formatNodeCount(productNodes.length)}
                        </Text>
                      </View>
                      <Ionicons
                        name={expanded ? "chevron-down" : "chevron-forward"}
                        size={15}
                        color={palette.muted}
                      />
                    </Pressable>
                    {!product.builtIn ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={format("删除产品：{name}", {
                          name: product.name,
                        })}
                        onPress={() => remove(product)}
                        hitSlop={8}
                        style={({ pressed }) => [
                          styles.trashButton,
                          styles.productTrash,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Ionicons
                          name="trash-outline"
                          size={16}
                          color={palette.muted}
                        />
                      </Pressable>
                    ) : null}
                  </View>

                  {expanded ? (
                    <View style={styles.nodeList}>
                      {productNodes.length === 0 ? (
                        <Text style={styles.nodeEmpty}>
                          {t("还没有节点")}
                        </Text>
                      ) : (
                        productNodes.map((node) => (
                          <View key={node.id} style={styles.nodeRow}>
                            <StatusDot online={node.online} size={6} />
                            <View style={styles.nodeText}>
                              <Text style={styles.nodeName} numberOfLines={1}>
                                {node.name}
                              </Text>
                              <Text
                                style={styles.nodeAddress}
                                numberOfLines={1}
                              >
                                {node.baseUrl}
                              </Text>
                            </View>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={format("删除节点：{name}", {
                                name: node.name,
                              })}
                              onPress={() => removeNodeItem(node)}
                              hitSlop={8}
                              style={({ pressed }) => [
                                styles.trashButton,
                                pressed && styles.pressed,
                              ]}
                            >
                              <Ionicons
                                name="trash-outline"
                                size={16}
                                color={palette.muted}
                              />
                            </Pressable>
                          </View>
                        ))
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    content: {
      paddingBottom: spacing.xxxl,
      gap: spacing.lg,
    },
    card: {
      gap: spacing.lg,
    },
    cardTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    cardTitle: {
      color: c.text,
      ...typography.section,
    },
    cardTitleSpacer: {
      flex: 1,
    },
    group: {
      gap: spacing.sm,
    },
    groupLabel: {
      color: c.muted,
      ...typography.label,
      fontSize: 12,
    },
    themeGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    themeOption: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      minWidth: 136,
      flexGrow: 1,
      flexBasis: "45%",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderRadius: radius.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surfaceAlt,
    },
    themeSwatch: {
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.25)",
    },
    themeName: {
      flex: 1,
      color: c.muted,
      ...typography.bodyStrong,
      fontSize: 13,
    },
    form: {
      gap: spacing.md,
    },
    formActions: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    formButton: {
      flex: 1,
    },
    productList: {
      gap: spacing.sm,
    },
    productBlock: {
      gap: spacing.xs,
    },
    productRow: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: radius.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surfaceAlt,
      overflow: "hidden",
    },
    productMain: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      minWidth: 0,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    productTrash: {
      marginRight: spacing.sm,
    },
    productIcon: {
      width: 32,
      height: 32,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surface,
    },
    productText: {
      flex: 1,
      gap: 2,
      minWidth: 0,
    },
    productNameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    productName: {
      color: c.text,
      ...typography.bodyStrong,
      fontSize: 14,
      flexShrink: 1,
    },
    productMeta: {
      color: c.muted,
      ...typography.mono,
      fontSize: 11,
    },
    trashButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    nodeList: {
      gap: 2,
      marginLeft: spacing.md,
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.xs,
      borderRadius: radius.control,
      backgroundColor: c.surface,
    },
    nodeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      minHeight: 44,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.control,
    },
    nodeText: {
      flex: 1,
      gap: 1,
      minWidth: 0,
    },
    nodeName: {
      color: c.text,
      ...typography.bodyStrong,
      fontSize: 13,
    },
    nodeAddress: {
      color: c.muted,
      ...typography.mono,
      fontSize: 10,
      letterSpacing: 0.2,
    },
    nodeEmpty: {
      color: c.muted,
      ...typography.caption,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
    },
    pressed: {
      opacity: 0.75,
    },
  });