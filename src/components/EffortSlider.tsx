import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
} from "react-native";

import {
  parseCssColor,
  useTheme,
  useThemedStyles,
  type Palette,
} from "../theme";

/**
 * Continuous reasoning-effort slider, matching the desktop intelligence slider:
 * a rounded track with a filled gradient and a single draggable knob. Steps
 * still snap while dragging, so the control keeps the discrete effort values
 * the node publishes.
 */
const TRACK_HEIGHT = 32;
const THUMB_SIZE = 28;
const THUMB_INSET = (TRACK_HEIGHT - THUMB_SIZE) / 2;
const GRADIENT_SLICES = 32;
/** The knob and its top highlight stay white in both modes, as on desktop. */
const KNOB_COLOR = "#FFFFFF";
const SHEEN_COLOR = "rgba(255, 255, 255, 0.22)";

export interface EffortSliderProps {
  /** Accessible name of the control. */
  label: string;
  /** Step labels in order: index 0 is the fastest, the last is the deepest. */
  steps: readonly string[];
  /** Selected step index. */
  value: number;
  onChange: (index: number) => void;
  disabled?: boolean;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function toRgb(color: string): Rgb | null {
  const parsed = parseCssColor(color);
  return parsed ? { r: parsed.r, g: parsed.g, b: parsed.b } : null;
}

function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue =
    max === rn
      ? (gn - bn) / delta + (gn < bn ? 6 : 0)
      : max === gn
        ? (bn - rn) / delta + 2
        : (rn - gn) / delta + 4;
  return { h: hue * 60, s: s * 100, l: l * 100 };
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const saturation = Math.min(100, Math.max(0, s)) / 100;
  const lightness = Math.min(100, Math.max(0, l)) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hue = ((((h % 360) + 360) % 360) / 60);
  const second = chroma * (1 - Math.abs((hue % 2) - 1));
  const [r, g, b] =
    hue < 1
      ? [chroma, second, 0]
      : hue < 2
        ? [second, chroma, 0]
        : hue < 3
          ? [0, chroma, second]
          : hue < 4
            ? [0, second, chroma]
            : hue < 5
              ? [second, 0, chroma]
              : [chroma, 0, second];
  const match = lightness - chroma / 2;
  return {
    r: Math.round((r + match) * 255),
    g: Math.round((g + match) * 255),
    b: Math.round((b + match) * 255),
  };
}

function rgbCss({ r, g, b }: Rgb): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * The accent drifts 28° in hue and deepens slightly along the track, so the
 * filled part reads as a range rather than one flat colour, like the desktop
 * slider's blue-to-violet fill.
 */
function buildGradient(accent: string): string[] {
  const base = toRgb(accent) ?? { r: 88, g: 97, b: 166 };
  const { h, s, l } = rgbToHsl(base);
  const colors: string[] = [];
  for (let index = 0; index < GRADIENT_SLICES; index += 1) {
    const ratio = GRADIENT_SLICES > 1 ? index / (GRADIENT_SLICES - 1) : 0;
    colors.push(rgbCss(hslToRgb(h + 28 * ratio, s + 6 * ratio, l - 4 * ratio)));
  }
  return colors;
}

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function EffortSlider({
  label,
  steps,
  value,
  onChange,
  disabled = false,
}: EffortSliderProps) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const lastStep = Math.max(steps.length - 1, 0);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const position = useRef(new Animated.Value(0)).current;
  const ratioRef = useRef(0);
  const draggingRef = useRef(false);
  const laidOutRef = useRef(false);
  const startRatioRef = useRef(0);

  const ratioForValue = lastStep > 0 ? clampRatio(value / lastStep) : 1;
  // The pan responder is created once, so it reads the live props from here.
  const stateRef = useRef({ width: 0, lastStep, value, disabled, onChange });
  stateRef.current = { width, lastStep, value, disabled, onChange };

  const gradient = useMemo(() => buildGradient(palette.accent), [palette.accent]);

  useEffect(() => {
    if (draggingRef.current) return;
    ratioRef.current = ratioForValue;
    if (!width) {
      position.setValue(ratioForValue);
      return;
    }
    // The first layout only establishes the knob position; sliding in from the
    // left while the sheet fades in would read as a glitch.
    if (!laidOutRef.current) {
      laidOutRef.current = true;
      position.setValue(ratioForValue);
      return;
    }
    Animated.timing(position, {
      duration: 160,
      toValue: ratioForValue,
      useNativeDriver: false,
    }).start();
  }, [position, ratioForValue, width]);

  const panResponder = useMemo(() => {
    const commit = (ratio: number) => {
      const clamped = clampRatio(ratio);
      const { lastStep: count, onChange: notify, value: current } = stateRef.current;
      ratioRef.current = clamped;
      position.setValue(clamped);
      if (count <= 0) return;
      const index = Math.round(clamped * count);
      if (index !== current) notify(index);
    };

    const finish = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      const { lastStep: count } = stateRef.current;
      const index = count > 0 ? Math.round(ratioRef.current * count) : 0;
      const snapped = count > 0 ? index / count : 0;
      ratioRef.current = snapped;
      Animated.timing(position, {
        duration: 140,
        toValue: snapped,
        useNativeDriver: false,
      }).start();
    };

    const active = () => !stateRef.current.disabled && stateRef.current.lastStep > 0;

    return PanResponder.create({
      onMoveShouldSetPanResponder: active,
      onPanResponderGrant: (event) => {
        const trackWidth = stateRef.current.width;
        if (!trackWidth) return;
        const usable = Math.max(trackWidth - THUMB_SIZE - THUMB_INSET * 2, 1);
        const offset = event.nativeEvent.locationX - THUMB_INSET - THUMB_SIZE / 2;
        const ratio = clampRatio(offset / usable);
        draggingRef.current = true;
        setDragging(true);
        startRatioRef.current = ratio;
        commit(ratio);
      },
      onPanResponderMove: (_event, gesture) => {
        if (!draggingRef.current) return;
        const usable = Math.max(
          stateRef.current.width - THUMB_SIZE - THUMB_INSET * 2,
          1,
        );
        commit(startRatioRef.current + gesture.dx / usable);
      },
      onPanResponderRelease: finish,
      onPanResponderTerminate: finish,
      // A mostly vertical swipe belongs to the sheet's scroll view.
      onPanResponderTerminationRequest: (_event, gesture) =>
        Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5,
      onStartShouldSetPanResponder: active,
    });
  }, [position]);

  const travel = Math.max(width - THUMB_SIZE - THUMB_INSET * 2, 0);
  const translateX = position.interpolate({
    inputRange: [0, 1],
    outputRange: [0, travel],
  });
  const fillWidth = position.interpolate({
    inputRange: [0, 1],
    outputRange:
      width > 0
        ? [THUMB_INSET + THUMB_SIZE / 2, width - THUMB_INSET - THUMB_SIZE / 2]
        : [0, 0],
  });
  // At the left end the knob covers the whole stub of fill except a crescent
  // peeking past its edge; the fill fades in as soon as the knob moves off it.
  const fillOpacity = position.interpolate({
    extrapolate: "clamp",
    inputRange: [0, 0.015],
    outputRange: [0, 1],
  });

  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    const delta = event.nativeEvent.actionName === "increment" ? 1 : -1;
    const next = Math.min(lastStep, Math.max(0, value + delta));
    if (next !== value) onChange(next);
  };

  const layer = (size: number) => ({
    width: size,
    height: size,
    borderRadius: size / 2,
    left: THUMB_INSET + THUMB_SIZE / 2 - size / 2,
    top: TRACK_HEIGHT / 2 - size / 2,
  });

  return (
    <View
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      accessibilityLabel={label}
      // ARIA mirrors `accessibilityValue` for react-native-web, which only
      // reads the deprecated per-field props.
      aria-valuemax={lastStep}
      aria-valuemin={0}
      aria-valuenow={value}
      aria-valuetext={steps[value]}
      accessibilityRole="adjustable"
      accessibilityState={{ disabled }}
      accessibilityValue={{
        min: 0,
        max: lastStep,
        now: value,
        text: steps[value],
      }}
      onAccessibilityAction={handleAccessibilityAction}
      onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
      style={[styles.root, disabled && styles.rootDisabled]}
      {...panResponder.panHandlers}
    >
      <View pointerEvents="none" style={styles.track}>
        {width > 0 ? (
          <Animated.View
            style={[styles.fillClip, { opacity: fillOpacity, width: fillWidth }]}
          >
            <View style={[styles.gradientRow, { width }]}>
              {gradient.map((color, index) => (
                <View
                  key={index}
                  style={[styles.gradientSlice, { backgroundColor: color }]}
                />
              ))}
            </View>
            <View style={styles.sheen} />
          </Animated.View>
        ) : null}

        <Animated.View
          style={[
            styles.glow,
            layer(34),
            {
              backgroundColor: palette.accent,
              opacity: dragging ? 0.28 : 0.18,
              transform: [{ translateX }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.thumb,
            {
              transform: [{ translateX }, { scale: dragging ? 1.06 : 1 }],
            },
          ]}
        />
      </View>
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      height: TRACK_HEIGHT + 12,
      justifyContent: "center",
      marginTop: 4,
    },
    rootDisabled: {
      opacity: 0.5,
    },
    track: {
      height: TRACK_HEIGHT,
      borderRadius: TRACK_HEIGHT / 2,
      backgroundColor: c.surfaceContainerHigh,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    fillClip: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      borderTopLeftRadius: TRACK_HEIGHT / 2,
      borderBottomLeftRadius: TRACK_HEIGHT / 2,
      overflow: "hidden",
    },
    gradientRow: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      flexDirection: "row",
    },
    gradientSlice: {
      flex: 1,
      height: "100%",
    },
    sheen: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: StyleSheet.hairlineWidth * 2,
      backgroundColor: SHEEN_COLOR,
    },
    glow: {
      position: "absolute",
    },
    thumb: {
      position: "absolute",
      left: THUMB_INSET,
      top: THUMB_INSET,
      width: THUMB_SIZE,
      height: THUMB_SIZE,
      borderRadius: THUMB_SIZE / 2,
      backgroundColor: KNOB_COLOR,
    },
  });