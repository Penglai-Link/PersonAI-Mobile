import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";

import { useI18n } from "../i18n";
import { useNodeLatency } from "../store/nodeLatency";
import { useTheme, type Palette } from "../theme";

interface NodeLatencyTextProps {
  nodeId: string;
  /** Renders a muted `—` before the first reading instead of nothing. */
  showPlaceholder?: boolean;
  /** Inline separator such as `·` when the reading follows other metadata. */
  leadingSeparator?: string;
  style?: StyleProp<TextStyle>;
}

/** Color carries the quality of the reading: local, okay, or slow. */
function latencyColor(palette: Palette, latencyMs: number): string {
  if (latencyMs <= 120) return palette.success;
  if (latencyMs <= 300) return palette.accent;
  return palette.danger;
}

/**
 * One node's latest tunnel heartbeat, refreshed by `NodeLatencyProvider`.
 * Renders nothing until the node has been sampled unless a placeholder is on.
 */
export function NodeLatencyText({
  nodeId,
  showPlaceholder = false,
  leadingSeparator,
  style,
}: NodeLatencyTextProps) {
  const { palette } = useTheme();
  const { t, format } = useI18n();
  const { latencies } = useNodeLatency();
  const latencyMs = latencies[nodeId]?.latencyMs ?? null;

  if (latencyMs === null && !showPlaceholder) return null;

  const value = latencyMs === null ? "—" : `${latencyMs} ms`;
  return (
    <Text
      style={[
        styles.text,
        {
          color:
            latencyMs === null
              ? palette.muted
              : latencyColor(palette, latencyMs),
        },
        style,
      ]}
      numberOfLines={1}
      accessibilityLabel={
        latencyMs === null
          ? t("延迟未知")
          : format("延迟 {value} 毫秒", { value: latencyMs })
      }
    >
      {leadingSeparator ? `${leadingSeparator} ${value}` : value}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.2,
    // The reading changes every sample; tabular digits keep it from jittering.
    fontVariant: ["tabular-nums"],
  },
});