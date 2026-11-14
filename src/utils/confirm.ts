import { Alert, Platform } from "react-native";

import { translate } from "../i18n";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
}

/**
 * Destructive confirmation. Web cannot use Alert buttons, so it falls back to
 * the browser confirm dialog.
 */
export function confirmDestructive({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
}: ConfirmOptions): void {
  const confirm = confirmLabel ?? translate("删除");
  const cancel = cancelLabel ?? translate("取消");

  if (Platform.OS === "web") {
    if (
      typeof window !== "undefined" &&
      window.confirm(`${translate(title)}\n\n${translate(message)}`)
    ) {
      onConfirm();
    }
    return;
  }

  Alert.alert(translate(title), translate(message), [
    { text: cancel, style: "cancel" },
    { text: confirm, style: "destructive", onPress: onConfirm },
  ]);
}