import { useEffect, useState } from "react";
import { Keyboard, Platform, type KeyboardEvent } from "react-native";
import {
  useSafeAreaFrame,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

/**
 * Height covered by a docked software keyboard, excluding the bottom safe-area
 * inset that `Screen` already reserves.
 *
 * `KeyboardAvoidingView` does not reliably apply its padding on iOS 26 and
 * leaves the composer underneath the keyboard. Listening to the keyboard
 * notifications directly keeps the padding in sync, including while the
 * keyboard is dragged down.
 */
export function useKeyboardOverlap(): number {
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  const [overlap, setOverlap] = useState(0);

  useEffect(() => {
    if (Platform.OS !== "ios") {
      setOverlap(0);
      return;
    }

    const update = (event: KeyboardEvent) => {
      const { height, screenY } = event.endCoordinates;
      if (height <= 0) {
        setOverlap(0);
        return;
      }
      // React Native reports the frame in window coordinates; `screenY` is 0
      // while iOS prepares the keyboard (cross-fade), so fall back to the
      // reported height in that case.
      const windowHeight = frame.height;
      const top = screenY > 0 ? screenY : windowHeight - height;
      setOverlap(Math.max(0, windowHeight - top - insets.bottom));
    };

    const show = Keyboard.addListener("keyboardWillShow", update);
    const change = Keyboard.addListener("keyboardWillChangeFrame", update);
    const hide = Keyboard.addListener("keyboardWillHide", () => setOverlap(0));

    return () => {
      show.remove();
      change.remove();
      hide.remove();
    };
  }, [frame.height, insets.bottom]);

  return overlap;
}