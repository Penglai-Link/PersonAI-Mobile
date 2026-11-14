import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  ApiError,
  SecurityError,
  assertTransportAllowed,
  isSecureBaseUrl,
  normalizeBaseUrl,
} from "../api/client";
import { createRemoteSession, type RemoteIdentity } from "../api/tron";
import { AppHeader } from "../components/AppHeader";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { InlineBanner } from "../components/InlineBanner";
import { LoadingView } from "../components/LoadingView";
import { Screen } from "../components/Screen";
import { SegmentedControl } from "../components/SegmentedControl";
import { TextField } from "../components/TextField";
import { Ionicons } from "../components/icons";
import { useI18n } from "../i18n";
import type { AddNodeMode, RootStackParamList } from "../navigation/types";
import { useConnections } from "../store/connections";
import {
  radius,
  spacing,
  typography,
  useTheme,
  useThemedStyles,
  type Palette,
} from "../theme";
import { translate } from "../i18n";
import { describeError, maskToken } from "../utils/format";
import { parsePairingUri, type PairingInfo } from "../utils/pairing";

type Props = NativeStackScreenProps<RootStackParamList, "AddNode">;

type ScanState = "scanning" | "parsed" | "invalid";

const SECURITY_BLOCK_MESSAGE =
  "出于安全考虑，已阻止通过非 HTTPS 地址连接。远程节点默认必须使用 https://；只有可信局域网中的调试节点，才可以在下方显式开启“不安全调试”并确认。";

function confirmInsecureConnection(): Promise<boolean> {
  const message = translate(
    "该节点使用非 HTTPS 地址，配对令牌、JWT 和聊天内容会以明文在网络上传输。只应在可信局域网或临时调试环境中使用。确定继续连接？",
  );
  if (Platform.OS === "web") {
    return Promise.resolve(
      typeof window !== "undefined" &&
        window.confirm(`${translate("不安全调试")}\n\n${message}`),
    );
  }
  return new Promise((resolve) => {
    Alert.alert(translate("不安全调试"), message, [
      {
        text: translate("取消"),
        style: "cancel",
        onPress: () => resolve(false),
      },
      {
        text: translate("继续连接"),
        style: "destructive",
        onPress: () => resolve(true),
      },
    ]);
  });
}

export function AddNodeScreen({ navigation, route }: Props) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { t, format } = useI18n();
  const productCode = route.params.productCode;
  const { products, addProduct, saveNode } = useConnections();

  const modeOptions: ReadonlyArray<{ value: AddNodeMode; label: string }> = [
    { value: "scan", label: t("扫码配对") },
    { value: "manual", label: t("手动输入") },
  ];

  const requestedMode = route.params.mode;
  const [mode, setMode] = useState<AddNodeMode>(requestedMode ?? "scan");
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [scanState, setScanState] = useState<ScanState>("scanning");
  const [scanned, setScanned] = useState<PairingInfo | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [allowInsecure, setAllowInsecure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (scanState !== "scanning") return;
      try {
        const pairing = parsePairingUri(result.data);
        setScanned(pairing);
        setAddress(pairing.baseUrl);
        setToken(pairing.token);
        if (pairing.machineName) setName(pairing.machineName);
        setAllowInsecure(false);
        setScanState("parsed");
        setError(null);
      } catch (scanError) {
        setScanned(null);
        setScanState("invalid");
        setError(describeError(scanError));
      }
    },
    [scanState],
  );

  const resetScan = useCallback(() => {
    setScanned(null);
    setScanState("scanning");
    setError(null);
    setCameraError(null);
    setAllowInsecure(false);
  }, []);

  const finish = useCallback(
    (targetProductCode: string, notice: string | null) => {
      if (!mountedRef.current) return;
      // Collapse the add-node flow back to the dashboard and the new node list.
      const goToNodes = () =>
        navigation.reset({
          index: 1,
          routes: [
            { name: "Dashboard" },
            { name: "Nodes", params: { productCode: targetProductCode } },
          ],
        });
      if (notice) {
        if (Platform.OS === "web") {
          if (typeof window !== "undefined") window.alert(notice);
          goToNodes();
        } else {
          Alert.alert(t("产品已自动纠正"), notice, [
            { text: t("好"), onPress: goToNodes },
          ]);
        }
        return;
      }
      goToNodes();
    },
    [navigation],
  );

  const connect = useCallback(async () => {
    if (submitting) return;
    setError(null);

    let normalizedBaseUrl: string;
    try {
      normalizedBaseUrl = normalizeBaseUrl(address);
    } catch (validationError) {
      setError(describeError(validationError));
      return;
    }
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      setError(t("请输入配对令牌"));
      return;
    }

    const insecure = !isSecureBaseUrl(normalizedBaseUrl);
    if (insecure && !allowInsecure) {
      setError(t(SECURITY_BLOCK_MESSAGE));
      return;
    }
    try {
      assertTransportAllowed(normalizedBaseUrl, allowInsecure);
    } catch (securityError) {
      setError(describeError(securityError));
      return;
    }
    if (insecure) {
      const confirmed = await confirmInsecureConnection();
      if (!confirmed) {
        setError(t("已取消不安全连接，未发送任何请求。"));
        return;
      }
    }

    setSubmitting(true);
    try {
      // Validates the pairing token and returns the short-lived JWT. Only the
      // pairing token itself is persisted (in SecureStore); the JWT stays in
      // memory inside the node session provider.
      const session = await createRemoteSession({
        baseUrl: normalizedBaseUrl,
        pairingToken: trimmedToken,
        timeoutMs: 12_000,
      });
      if (!mountedRef.current) return;
      const identity: RemoteIdentity = session.identity;

      const identityProductCode = (identity.productCode || productCode)
        .trim()
        .toLowerCase();
      let targetProductCode = productCode;
      let notice: string | null = null;
      if (identityProductCode !== productCode) {
        targetProductCode = identityProductCode;
        if (!products.some((product) => product.code === targetProductCode)) {
          try {
            addProduct({
              code: targetProductCode,
              name: identity.productName || identityProductCode,
            });
          } catch (productError) {
            setError(
              format(
                "该节点属于产品「{product}」（{code}），但无法自动创建该产品：{error}",
                {
                  product: identity.productName || identityProductCode,
                  code: identityProductCode,
                  error: describeError(productError),
                },
              ),
            );
            return;
          }
        }
        notice = format(
          "该节点属于产品「{product}」（{code}），已自动归入该产品，而不是当前产品。",
          {
            product: identity.productName || targetProductCode,
            code: targetProductCode,
          },
        );
      }

      await saveNode({
        productCode: targetProductCode,
        name: name.trim() || identity.machineName?.trim() || t("Tron 电脑"),
        baseUrl: normalizedBaseUrl,
        pairingToken: trimmedToken,
        allowInsecure: insecure,
        nodeId: identity.nodeId,
        platform: identity.platform,
        version: identity.version,
        username: identity.profile?.username ?? null,
        displayName: identity.profile?.displayName ?? null,
      });
      finish(targetProductCode, notice);
    } catch (connectionError) {
      if (
        connectionError instanceof ApiError &&
        (connectionError.status === 401 || connectionError.status === 403)
      ) {
        setError(
        t("配对令牌无效或已过期，请在电脑端重新生成配对二维码"),
      );
      } else if (connectionError instanceof SecurityError) {
        setError(connectionError.message);
      } else {
        setError(describeError(connectionError));
      }
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  }, [
    addProduct,
    address,
    allowInsecure,
    finish,
    name,
    productCode,
    products,
    saveNode,
    submitting,
    token,
  ]);

  const insecureAddress = (() => {
    try {
      return address.trim() ? !isSecureBaseUrl(normalizeBaseUrl(address)) : false;
    } catch {
      return false;
    }
  })();

  const renderScanPanel = () => {
    if (scanState === "parsed" && scanned) {
      const pairingInsecure = !isSecureBaseUrl(scanned.baseUrl);
      const confirmed = allowInsecure;
      return (
        <View style={styles.stack}>
          <Card style={styles.successCard}>
            <View style={styles.successHeader}>
              <View style={styles.successIcon}>
                <Ionicons name="checkmark" size={18} color={palette.accent} />
              </View>
              <View style={styles.successTitleBlock}>
                <Text style={styles.successTitle}>
                  {t("已识别配对信息")}
                </Text>
              </View>
              <Badge label={t("已扫描")} tone="accent" />
            </View>

            <View style={styles.detailList}>
              <DetailRow
                label={t("节点", "singular")}
                value={scanned.machineName || name || t("未命名电脑")}
              />
              <DetailRow label={t("地址")} value={scanned.baseUrl} mono />
              <DetailRow
                label={t("令牌")}
                value={maskToken(scanned.token)}
                mono
              />
              <DetailRow
                label={t("产品", "singular")}
                value={`${scanned.productName}（${scanned.productCode}）`}
              />
              {scanned.nodeId ? (
                <DetailRow label={t("节点 ID")} value={scanned.nodeId} mono />
              ) : null}
              <DetailRow
                label={t("安全")}
                value={
                  pairingInsecure
                    ? scanned.secure
                      ? t("HTTPS 未启用（配对标记为不安全）")
                      : t("非 HTTPS（配对标记为不安全）")
                    : "HTTPS"
                }
              />
            </View>

            {pairingInsecure ? (
              <View style={styles.insecureBlock}>
                <InlineBanner message={t(SECURITY_BLOCK_MESSAGE)} />
                <ToggleRow
                  label={t("我确认这是可信局域网中的不安全调试连接")}
                  value={confirmed}
                  onChange={setAllowInsecure}
                />
              </View>
            ) : null}

            <View style={styles.scanActions}>
              <Button
                label={t("连接并保存")}
                icon="link-outline"
                loading={submitting}
                disabled={pairingInsecure && !confirmed}
                onPress={() => void connect()}
                fullWidth
              />
              <Button
                label={t("重新扫描")}
                icon="scan-outline"
                variant="secondary"
                onPress={resetScan}
                disabled={submitting}
                fullWidth
              />
            </View>
          </Card>

          <TextField
            label={t("节点名称（可选）")}
            value={name}
            onChangeText={setName}
            placeholder={t("例如：书房 Mac")}
            autoCapitalize="none"
          />
          {error ? (
            <InlineBanner
              message={error}
              actionLabel={t("重试")}
              onAction={() => void connect()}
            />
          ) : null}
        </View>
      );
    }

    if (cameraError) {
      return (
        <View style={styles.stack}>
          <EmptyState
            icon="camera-outline"
            title={t("摄像头不可用")}
            message={format("{error}\n你仍然可以使用手动输入完成配对。", {
              error: cameraError,
            })}
            action={
              <Button
                label={t("手动输入")}
                icon="create-outline"
                variant="secondary"
                onPress={() => setMode("manual")}
              />
            }
          />
        </View>
      );
    }

    if (!permission) {
      return <LoadingView compact label={t("正在检查相机权限…")} />;
    }

    if (!permission.granted) {
      return (
        <View style={styles.stack}>
          <EmptyState
            icon="camera-outline"
            title={t("需要相机权限")}
            message={t(
              "PersonAI 使用相机扫描电脑端展示的配对二维码。你也可以直接手动输入地址和令牌。",
            )}
            action={
              <View style={styles.emptyButtonColumn}>
                <Button
                  label={
                    permission.canAskAgain
                      ? t("允许使用相机")
                      : t("打开系统设置")
                  }
                  icon="camera-outline"
                  onPress={() => {
                    if (permission.canAskAgain) {
                      void requestPermission();
                    } else {
                      void Linking.openSettings();
                    }
                  }}
                  fullWidth
                />
                <Button
                  label={t("手动输入")}
                  variant="secondary"
                  onPress={() => setMode("manual")}
                  fullWidth
                />
              </View>
            }
          />
        </View>
      );
    }

    return (
      <View style={styles.stack}>
        <View style={styles.cameraFrame}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={
              scanState === "scanning" ? handleBarcodeScanned : undefined
            }
            onMountError={(event) => {
              setCameraError(event.message || t("摄像头启动失败"));
            }}
          />
          <View pointerEvents="none" style={styles.scanOverlay}>
            <View style={styles.scanBox} />
            <Text style={styles.scanInstruction}>
              {t("将配对二维码放入框内")}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={torch ? t("关闭手电筒") : t("打开手电筒")}
            onPress={() => setTorch((value) => !value)}
            style={({ pressed }) => [styles.torchButton, pressed && styles.pressed]}
          >
            <Ionicons
              name={torch ? "flashlight" : "flashlight-outline"}
              size={18}
              color={torch ? palette.accent : palette.text}
            />
          </Pressable>
        </View>

        {scanState === "invalid" ? (
          <View style={styles.stack}>
            {error ? <InlineBanner message={error} /> : null}
            <Button
              label={t("重新扫描")}
              icon="scan-outline"
              variant="secondary"
              onPress={resetScan}
              fullWidth
            />
          </View>
        ) : (
          <Text style={styles.scanHint}>
            {t(
              "在电脑端打开配对二维码，对准后自动识别。",
            )}
          </Text>
        )}

        {error && scanState !== "invalid" ? (
          <InlineBanner message={error} />
        ) : null}
      </View>
    );
  };

  return (
    <Screen>
      <AppHeader
        title={
          requestedMode
            ? mode === "scan"
              ? t("扫码配对")
              : t("手动输入")
            : t("添加节点")
        }
        onBack={() => navigation.goBack()}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {requestedMode && mode === requestedMode ? null : (
            <SegmentedControl
              options={modeOptions}
              value={mode}
              onChange={(nextMode) => {
                setMode(nextMode);
                setError(null);
              }}
            />
          )}

          {mode === "scan" ? (
            renderScanPanel()
          ) : (
            <ManualPanel
              name={name}
              address={address}
              token={token}
              showToken={showToken}
              allowInsecure={allowInsecure}
              insecureAddress={insecureAddress}
              error={error}
              submitting={submitting}
              onNameChange={setName}
              onAddressChange={setAddress}
              onTokenChange={setToken}
              onToggleToken={() => setShowToken((value) => !value)}
              onToggleInsecure={setAllowInsecure}
              onSubmit={() => void connect()}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

interface ManualPanelProps {
  name: string;
  address: string;
  token: string;
  showToken: boolean;
  allowInsecure: boolean;
  insecureAddress: boolean;
  error: string | null;
  submitting: boolean;
  onNameChange: (value: string) => void;
  onAddressChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onToggleToken: () => void;
  onToggleInsecure: (value: boolean) => void;
  onSubmit: () => void;
}

function ManualPanel({
  name,
  address,
  token,
  showToken,
  allowInsecure,
  insecureAddress,
  error,
  submitting,
  onNameChange,
  onAddressChange,
  onTokenChange,
  onToggleToken,
  onToggleInsecure,
  onSubmit,
}: ManualPanelProps) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { t } = useI18n();
  return (
    <View style={styles.stack}>
      <TextField
        label={t("节点名称（可选）")}
        value={name}
        onChangeText={onNameChange}
        placeholder={t("例如：书房 Mac")}
        autoCapitalize="none"
      />
      <TextField
        label={t("节点地址")}
        value={address}
        onChangeText={onAddressChange}
        placeholder="https://tron.example.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <TextField
        label={t("配对令牌")}
        value={token}
        onChangeText={onTokenChange}
        placeholder={t("粘贴配对令牌")}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={!showToken}
        rightAccessory={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              showToken ? t("隐藏令牌") : t("显示令牌")
            }
            onPress={onToggleToken}
            hitSlop={8}
          >
            <Ionicons
              name={showToken ? "eye-off-outline" : "eye-outline"}
              size={18}
              color={palette.muted}
            />
          </Pressable>
        }
      />

      {insecureAddress ? (
        <View style={styles.insecureBlock}>
          <InlineBanner message={t(SECURITY_BLOCK_MESSAGE)} />
          <ToggleRow
            label={t("不安全调试：允许通过 http:// 连接该节点")}
            value={allowInsecure}
            onChange={onToggleInsecure}
          />
        </View>
      ) : null}

      {error ? <InlineBanner message={error} /> : null}

      <Button
        label={t("验证并保存")}
        icon="link-outline"
        loading={submitting}
        disabled={insecureAddress && !allowInsecure}
        onPress={onSubmit}
        fullWidth
      />
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={() => onChange(!value)}
      style={({ pressed }) => [styles.toggleRow, pressed && styles.pressed]}
    >
      <View style={[styles.toggleTrack, value && styles.toggleTrackOn]}>
        <View style={[styles.toggleThumb, value && styles.toggleThumbOn]} />
      </View>
      <Text style={styles.toggleLabel}>{label}</Text>
      {value ? (
        <Ionicons name="warning-outline" size={16} color={palette.danger} />
      ) : null}
    </Pressable>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text
        style={[styles.detailValue, mono && styles.monoValue]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    flex: {
      flex: 1,
    },
    content: {
      paddingBottom: spacing.xxxl,
      gap: spacing.xl,
    },
    stack: {
      gap: spacing.lg,
    },
    cameraFrame: {
      width: "100%",
      maxWidth: 400,
      alignSelf: "center",
      aspectRatio: 3 / 4,
      borderRadius: radius.card,
      overflow: "hidden",
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    scanOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      backgroundColor: c.scrim,
    },
    scanBox: {
      width: "68%",
      aspectRatio: 1,
      borderWidth: 2,
      borderColor: c.accent,
      borderRadius: radius.card,
      backgroundColor: c.accentSoft,
    },
    scanInstruction: {
      color: c.text,
      ...typography.caption,
      backgroundColor: c.overlay,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.pill,
    },
    torchButton: {
      position: "absolute",
      top: spacing.md,
      right: spacing.md,
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.overlay,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    pressed: {
      opacity: 0.7,
    },
    scanHint: {
      color: c.muted,
      ...typography.caption,
      textAlign: "center",
      lineHeight: 18,
    },
    successCard: {
      gap: spacing.lg,
      borderColor: c.accentBorder,
    },
    successHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    successIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.accentSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.accentBorder,
    },
    successTitleBlock: {
      flex: 1,
      gap: 2,
    },
    successTitle: {
      color: c.text,
      ...typography.bodyStrong,
    },
    successHint: {
      color: c.muted,
      ...typography.caption,
      fontSize: 11,
    },
    detailList: {
      gap: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      paddingTop: spacing.md,
    },
    detailRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    detailLabel: {
      width: 56,
      color: c.muted,
      ...typography.caption,
    },
    detailValue: {
      flex: 1,
      color: c.text,
      ...typography.caption,
    },
    monoValue: {
      fontFamily: Platform.select({
        ios: "Menlo",
        android: "monospace",
        default: "monospace",
      }),
    },
    scanActions: {
      gap: spacing.sm,
    },
    emptyButtonColumn: {
      width: "100%",
      maxWidth: 320,
      gap: spacing.sm,
    },
    infoCard: {
      padding: spacing.md,
      backgroundColor: c.surfaceAlt,
    },
    infoRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
    },
    infoText: {
      flex: 1,
      color: c.muted,
      ...typography.caption,
      fontSize: 11,
      lineHeight: 17,
    },
    insecureBlock: {
      gap: spacing.sm,
    },
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.dangerBorder,
      backgroundColor: c.dangerSoft,
    },
    toggleTrack: {
      width: 38,
      height: 22,
      borderRadius: 11,
      padding: 2,
      backgroundColor: c.border,
      justifyContent: "center",
    },
    toggleTrackOn: {
      backgroundColor: c.danger,
    },
    toggleThumb: {
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: c.surface,
    },
    toggleThumbOn: {
      alignSelf: "flex-end",
      backgroundColor: c.text,
    },
    toggleLabel: {
      flex: 1,
      color: c.text,
      ...typography.caption,
      lineHeight: 17,
    },
  });