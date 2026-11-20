import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  REASONING_EFFORTS,
  isAutoModelOption,
  type ModelSelectOption,
  type ReasoningEffort,
} from "../api/tron";
import { useI18n } from "../i18n";
import {
  radius,
  spacing,
  typography,
  useTheme,
  useThemedStyles,
  type Palette,
} from "../theme";
import { EffortSlider } from "./EffortSlider";
import { Ionicons } from "./icons";

export interface ModelEffortSelectorLabels {
  triggerAria: (model: string, effort: string | null) => string;
  panelTitle: string;
  effortLabel: string;
  automatic: string;
  faster: string;
  deeper: string;
  currentModel: string;
  changeModel: string;
  hideModels: string;
  searchPlaceholder: string;
  noMatch: (query: string) => string;
  autoName: string;
  providerModels: string;
  qualityGroup: (quality: string, vendor: string) => string;
  empty: string;
  loading: string;
  close: string;
  effortNames: Record<ReasoningEffort, string>;
  qualityNames: Record<string, string>;
}

interface ModelEffortSelectorProps {
  options: ModelSelectOption[];
  loading: boolean;
  selected: ModelSelectOption | null;
  onSelectModel: (option: ModelSelectOption) => void;
  /** `null` means "let the node decide" (自动). */
  effort: ReasoningEffort | null;
  onSelectEffort: (effort: ReasoningEffort | null) => void;
  disabled?: boolean;
  labels: ModelEffortSelectorLabels;
}

function fuzzyValue(value: string): string {
  return value.trim().toLowerCase().replace(/[\s\-_/.:]+/g, "");
}

function fuzzyMatch(query: string, target: string): boolean {
  const raw = query.trim().toLowerCase();
  if (!raw) return true;
  const lowered = target.toLowerCase();
  if (lowered.includes(raw)) return true;
  const normalized = fuzzyValue(query);
  if (!normalized) return true;
  const normalizedTarget = fuzzyValue(target);
  if (normalizedTarget.includes(normalized)) return true;
  // Subsequence match, mirroring the desktop selector's fuzzy pass.
  let index = 0;
  for (const char of normalizedTarget) {
    if (char === normalized[index]) index += 1;
    if (index === normalized.length) return true;
  }
  return false;
}

function formatMultiplier(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return String(Number(value.toFixed(6)));
}

/**
 * Model + reasoning-effort control for the composer.
 *
 * Mirrors the desktop `ChatModelEffortSelector`: the node's auto route is the
 * default, the list is grouped exactly as the desktop groups it, and the effort
 * track only appears when the selected model advertises efforts.
 */
export function ModelEffortSelector({
  options,
  loading,
  selected,
  onSelectModel,
  effort,
  onSelectEffort,
  disabled = false,
  labels,
}: ModelEffortSelectorProps) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { t } = useI18n();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Percent max-height does not bound a ScrollView's content in Yoga; the list
  // needs an explicit pixel cap to scroll.
  const sheetMaxHeight = Math.round(windowHeight * 0.78);
  const listMaxHeight = Math.max(240, sheetMaxHeight - 150);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [modelsOpen, setModelsOpen] = useState(false);

  const modelLabel = (option: ModelSelectOption): string =>
    isAutoModelOption(option) ? labels.autoName : option.displayName;
  const selectedLabel = loading
    ? labels.loading
    : selected
      ? modelLabel(selected)
      : labels.empty;

  // Desktop prepends 自动 when the model has no configured default effort.
  const steps = useMemo<Array<{ label: string; value: ReasoningEffort | null }>>(
    () => {
      const supported = (selected?.supportedReasoningEfforts ?? []).filter(
        (value) => REASONING_EFFORTS.includes(value),
      );
      // Exactly the desktop rule: only the stages the selected model publishes
      // are offered. PersonAI publishes 自动/低/高/最大; models without
      // published stages show just the model list.
      if (!supported.length) return [];
      const ordered = REASONING_EFFORTS.filter((value) =>
        supported.includes(value),
      ).map((value) => ({
        label: labels.effortNames[value] ?? value,
        value,
      }));
      // A model with its own default effort offers only concrete steps; the
      // others get the extra "自动" (let the node decide) step first.
      return selected?.defaultReasoningEffort
        ? ordered
        : [{ label: labels.automatic, value: null }, ...ordered];
    },
    [labels, selected],
  );
  const hasEffort = steps.length > 0;
  const effortIndex = Math.max(
    0,
    steps.findIndex((step) => step.value === effort),
  );
  const effortLabel = hasEffort ? steps[effortIndex]?.label ?? labels.automatic : null;
  const stepLabels = useMemo(() => steps.map((step) => step.label), [steps]);

  const filtered = useMemo(
    () =>
      options.filter(
        (option) =>
          option.enabled &&
          (fuzzyMatch(query, modelLabel(option)) ||
            fuzzyMatch(query, option.modelName) ||
            fuzzyMatch(query, option.accessPlatform ?? "") ||
            fuzzyMatch(query, option.upstreamVendorName ?? option.vendor ?? "")),
      ),
    // `modelLabel` only depends on the constant auto label.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labels.autoName, options, query],
  );
  const autoOptions = filtered.filter(isAutoModelOption);
  const grouped = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; label: string; models: ModelSelectOption[] }
    >();
    for (const option of filtered) {
      if (isAutoModelOption(option)) continue;
      const quality = option.qualityType ?? "High";
      const vendor =
        option.upstreamVendorName ?? option.vendor ?? labels.providerModels;
      const personAi = option.providerCode === "PersonAi";
      const key = personAi
        ? `${option.providerCode}:${quality}:${vendor}`
        : option.accessPlatform ?? "platform";
      const label = personAi
        ? labels.qualityGroup(labels.qualityNames[quality] ?? quality, vendor)
        : option.accessPlatform ?? labels.providerModels;
      const group = groups.get(key) ?? { key, label, models: [] };
      group.models.push(option);
      groups.set(key, group);
    }
    return [...groups.values()].map((group) => ({
      ...group,
      models: [...group.models].sort((left, right) =>
        left.displayName.localeCompare(right.displayName),
      ),
    }));
  }, [filtered, labels]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const openPanel = () => {
    if (disabled) return;
    setQuery("");
    // The model list stays collapsed until the user asks for it.
    setModelsOpen(false);
    setOpen(true);
  };

  const chooseModel = (option: ModelSelectOption) => {
    if (option.optionCode !== selected?.optionCode) onSelectModel(option);
    close();
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          hasEffort && effortLabel
            ? labels.triggerAria(selectedLabel, effortLabel)
            : labels.triggerAria(selectedLabel, null)
        }
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={openPanel}
        style={({ pressed }) => [
          styles.trigger,
          disabled && styles.triggerDisabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.triggerLabel} numberOfLines={1}>
          {selectedLabel}
        </Text>
        {hasEffort && effortLabel ? (
          <>
            <Text style={styles.triggerSeparator}>·</Text>
            <Text style={styles.triggerEffort} numberOfLines={1}>
              {effortLabel}
            </Text>
          </>
        ) : null}
        {loading ? (
          <ActivityIndicator size="small" color={palette.muted} />
        ) : (
          <Ionicons name="chevron-down" size={12} color={palette.muted} />
        )}
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={close}
        transparent
        visible={open}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.close}
          onPress={close}
          style={styles.backdrop}
        />
        <View style={[styles.sheet, { maxHeight: sheetMaxHeight }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{labels.panelTitle}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={labels.close}
              hitSlop={8}
              onPress={close}
            >
              <Ionicons name="close" size={18} color={palette.muted} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={[styles.sheetBody, { paddingBottom: spacing.xl + insets.bottom }]}
            keyboardShouldPersistTaps="handled"
            style={[styles.sheetScroll, { maxHeight: listMaxHeight }]}
          >
            {hasEffort ? (
              <View style={styles.effortBlock}>
                <Text style={styles.sectionLabel}>{labels.effortLabel}</Text>
                <Text style={styles.effortValue}>{effortLabel}</Text>
                <EffortSlider
                  label={labels.effortLabel}
                  onChange={(index) => onSelectEffort(steps[index]?.value ?? null)}
                  steps={stepLabels}
                  value={effortIndex}
                />
                <View style={styles.trackLabels}>
                  <Text style={styles.trackLabel}>{labels.faster}</Text>
                  <Text style={styles.trackLabel}>{labels.deeper}</Text>
                </View>
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: modelsOpen }}
              onPress={() => setModelsOpen((value) => !value)}
              style={({ pressed }) => [
                styles.modelToggle,
                hasEffort && styles.modelToggleSpaced,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.modelToggleText}>
                <Text style={styles.sectionLabel}>{labels.currentModel}</Text>
                <Text style={styles.modelToggleName} numberOfLines={1}>
                  {selectedLabel}
                </Text>
              </View>
              <Text style={styles.modelToggleAction}>
                {modelsOpen ? labels.hideModels : labels.changeModel}
              </Text>
              <Ionicons
                name={modelsOpen ? "chevron-up" : "chevron-down"}
                size={13}
                color={palette.muted}
              />
            </Pressable>

            {modelsOpen ? (
              <View style={styles.modelList}>
                <View style={styles.searchRow}>
                  <Ionicons name="search" size={13} color={palette.muted} />
                  <TextInput
                    accessibilityLabel={labels.searchPlaceholder}
                    onChangeText={setQuery}
                    placeholder={labels.searchPlaceholder}
                    placeholderTextColor={palette.muted}
                    style={styles.searchInput}
                    value={query}
                  />
                </View>
                {filtered.length === 0 ? (
                  <Text style={styles.hint}>{labels.noMatch(query.trim())}</Text>
                ) : (
                  <View accessibilityRole="radiogroup">
                    {autoOptions.map((option) => (
                      <ModelRow
                        key={option.optionCode}
                        checked={option.optionCode === selected?.optionCode}
                        label={modelLabel(option)}
                        multiplier={null}
                        onPress={() => chooseModel(option)}
                        subtitle={option.upstreamVendorName}
                      />
                    ))}
                    {grouped.map((group) => (
                      <View key={group.key}>
                        <Text style={styles.groupLabel}>{group.label}</Text>
                        {group.models.map((option) => (
                          <ModelRow
                            key={option.optionCode}
                            checked={option.optionCode === selected?.optionCode}
                            label={modelLabel(option)}
                            multiplier={
                              option.providerCode === "PersonAi" &&
                              !isAutoModelOption(option)
                                ? formatMultiplier(option.outputCoefficient)
                                : null
                            }
                            onPress={() => chooseModel(option)}
                            subtitle={option.upstreamVendorName}
                          />
                        ))}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

function ModelRow({
  checked,
  label,
  multiplier,
  onPress,
  subtitle,
}: {
  checked: boolean;
  label: string;
  multiplier: string | null;
  onPress: () => void;
  subtitle?: string | null;
}) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked }}
      onPress={onPress}
      style={({ pressed }) => [styles.modelRow, pressed && styles.pressed]}
    >
      <View style={[styles.radio, checked && styles.radioChecked]}>
        {checked ? (
          <Ionicons name="checkmark" size={11} color={palette.onAccent} />
        ) : null}
      </View>
      <View style={styles.modelRowText}>
        <Text style={styles.modelRowLabel} numberOfLines={1}>
          {label}
        </Text>
        {subtitle ? (
          <Text style={styles.modelRowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {multiplier ? <Text style={styles.multiplier}>{multiplier}</Text> : null}
    </Pressable>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    // Mirrors the desktop trigger: a transparent inline control, not a button.
    trigger: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      maxWidth: 200,
      minHeight: 28,
      paddingHorizontal: spacing.xs,
      borderRadius: radius.control,
    },
    triggerDisabled: {
      opacity: 0.5,
    },
    triggerLabel: {
      flexShrink: 1,
      color: c.muted,
      ...typography.caption,
      fontSize: 11,
    },
    triggerSeparator: {
      color: c.border,
      ...typography.caption,
      fontSize: 11,
    },
    triggerEffort: {
      flexShrink: 0,
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
      maxHeight: "78%",
      borderTopLeftRadius: radius.card,
      borderTopRightRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.background,
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
    sheetScroll: {
      flexGrow: 0,
      flexShrink: 1,
    },
    sheetBody: {
      padding: spacing.lg,
      paddingBottom: spacing.xl,
      gap: spacing.sm,
    },
    effortBlock: {
      gap: 4,
    },
    sectionLabel: {
      color: c.muted,
      ...typography.caption,
      fontSize: 11,
      fontWeight: "600",
    },
    effortValue: {
      color: c.accent,
      ...typography.bodyStrong,
      fontSize: 20,
    },
    trackLabels: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 2,
    },
    trackLabel: {
      color: c.muted,
      ...typography.caption,
      fontSize: 10,
    },
    modelToggle: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    modelToggleSpaced: {
      marginTop: spacing.sm,
    },
    modelToggleText: {
      flex: 1,
      minWidth: 0,
    },
    modelToggleName: {
      color: c.text,
      ...typography.caption,
      fontWeight: "600",
    },
    modelToggleAction: {
      color: c.muted,
      ...typography.caption,
      fontSize: 10,
    },
    modelList: {
      gap: spacing.xs,
    },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    searchInput: {
      flex: 1,
      minHeight: 34,
      color: c.text,
      ...typography.caption,
      paddingVertical: spacing.xs,
    },
    groupLabel: {
      color: c.muted,
      ...typography.caption,
      fontSize: 10,
      fontWeight: "700",
      marginTop: spacing.sm,
      marginBottom: 2,
      paddingHorizontal: spacing.sm,
    },
    modelRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderRadius: radius.control,
    },
    radio: {
      width: 16,
      height: 16,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    radioChecked: {
      backgroundColor: c.accent,
      borderColor: c.accent,
    },
    modelRowText: {
      flex: 1,
      minWidth: 0,
    },
    modelRowLabel: {
      color: c.text,
      ...typography.caption,
      fontWeight: "600",
    },
    modelRowSubtitle: {
      color: c.muted,
      ...typography.caption,
      fontSize: 10,
    },
    multiplier: {
      color: c.muted,
      ...typography.caption,
      fontSize: 10,
    },
    hint: {
      color: c.muted,
      ...typography.caption,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
    },
    pressed: {
      opacity: 0.7,
    },
  });