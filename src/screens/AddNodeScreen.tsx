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

import { ApiError, isDeviceAuthError, isTicketError, normalizeBaseUrl } from "../api/client";
import { tunnels, type TunnelTarget } from "../api/tunnel";
import { ensureDeviceKey } from "../crypto/keys";
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
import { describeError } from "../utils/format";
import { isPairingUri, parsePairingUri, type PairingInfo } from "../utils/pairing";

type Props = NativeStackScreenProps<RootStackParamList, "AddNode">;

type ScanState = "scanning" | "parsed" | "invalid";

const TICKET_MESSAGE =
  "配对票据无效或已过期，请在电脑端刷新配对二维码后重新扫码配对。";
const DEVICE_MESSAGE =
  "电脑已拒绝这台设备（可能已被吊销），请删除节点后重新配对。";

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
  const [manualUri, setManualUri] = useState("");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyPairing = useCallback((pairing: PairingInfo) => {
    setScanned(pairing);
    setScanState("parsed");
    setError(null);
  }, []);

  const handleBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (scanState !== "scanning") return;
      try {
        applyPairing(parsePairingUri(result.data));
      } catch (scanError) {
        setScanned(null);
        setScanState("invalid");
        setError(describeError(scanError));
      }
    },
    [applyPairing, scanState],
  );

  const resetScan = useCallback(() => {
    setScanned(null);
    setScanState("scanning");
    setError(null);
    setCameraError(null);
  }, []);

  const finish = useCallback(
    (targetProductCode: string, notice: string | null) => {
      if (!mountedRef.current) return;
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
    [navigation, t],
  );

  const connect = useCallback(
    async (pairing: PairingInfo) => {
      if (submitting) return;
      setError(null);

      let baseUrl: string;
      try {
        baseUrl = normalizeBaseUrl(pairing.baseUrl);
      } catch (validationError) {
        setError(describeError(validationError));
        return;
      }

      setSubmitting(true);
      try {
        const target: TunnelTarget = {
          baseUrl,
          transport: pairing.transport,
          nodeId: pairing.nodeId,
          productCode: pairing.productCode,
          nodeKey: pairing.nodeKey,
          keyId: pairing.keyId,
          deviceId: null,
          lanBaseUrl: pairing.lanBaseUrl ?? null,
          publicBaseUrl: pairing.publicBaseUrl ?? null,
        };
        const deviceKey = await ensureDeviceKey(pairing.nodeId);
        // The device name belongs to this phone, not to the computer. The node
        // name comes from the pairing QR and is never sent back to the server.
        const tunnel = await tunnels.connectOnceBest(target, {
          ticket: pairing.ticket,
          handshakeTimeoutMs: 12_000,
          authTimeoutMs: 15_000,
        });
        if (!mountedRef.current) {
          tunnel.close();
          return;
        }
        const ready = tunnel.ready;

        const identityProductCode = (ready.product.productCode || productCode)
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
                name: ready.product.productName || identityProductCode,
              });
            } catch (productError) {
              tunnel.close();
              setError(
                format(
                  "该节点属于产品「{product}」（{code}），但无法自动创建该产品：{error}",
                  {
                    product: ready.product.productName || identityProductCode,
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
              product: ready.product.productName || targetProductCode,
              code: targetProductCode,
            },
          );
        }

        await saveNode({
          productCode: targetProductCode,
          name: pairing.machineName?.trim() || t("未命名电脑"),
          baseUrl: tunnel.baseUrl,
          lanBaseUrl: pairing.lanBaseUrl ?? null,
          publicBaseUrl: pairing.publicBaseUrl ?? null,
          nodeId: pairing.nodeId,
          nodeKey: pairing.nodeKey,
          keyId: pairing.keyId,
          deviceId: ready.deviceId,
          methods: ready.methods,
          platform: ready.product.platform || null,
          version: ready.product.version || null,
        });
        if (deviceKey.persisted === false) {
          notice =
            notice ??
            t(
              "设备密钥无法写入系统安全存储，本次连接仅在当前进程内有效。",
            );
        }
        finish(targetProductCode, notice);
      } catch (connectionError) {
        if (!mountedRef.current) return;
        if (isTicketError(connectionError)) {
          setError(t(TICKET_MESSAGE));
        } else if (isDeviceAuthError(connectionError)) {
          setError(t(DEVICE_MESSAGE));
        } else if (
          connectionError instanceof ApiError &&
          connectionError.code === "DEVICE_KEY_MISSING"
        ) {
          setError(t("设备密钥缺失，请重新配对。"));
        } else {
          setError(describeError(connectionError));
        }
      } finally {
        if (mountedRef.current) setSubmitting(false);
      }
    },
    [
      addProduct,
      finish,
      format,
      productCode,
      products,
      saveNode,
      submitting,
      t,
    ],
  );

  const connectManual = useCallback(async () => {
    if (!isPairingUri(manualUri)) {
      setError(t("请粘贴完整的配对链接（以 tron://pair? 开头）"));
      return;
    }
    try {
      const pairing = parsePairingUri(manualUri);
      applyPairing(pairing);
      await connect(pairing);
    } catch (manualError) {
      setError(describeError(manualError));
    }
  }, [applyPairing, connect, manualUri, t]);

  const renderScanPanel = () => {
    if (scanState === "parsed" && scanned) {
      return (
        <View style={styles.stack}>
          <PairingCard
            pairing={scanned}
            submitting={submitting}
            onConnect={() => void connect(scanned)}
            onRescan={resetScan}
            error={error}
          />
        </View>
      );
    }

    if (cameraError) {
      return (
        <View style={styles.stack}>
          <EmptyState
            icon="camera-outline"
            title={t("摄像头不可用")}
            message={format(
              "{error}\n你仍然可以使用手动输入粘贴配对链接。",
              { error: cameraError },
            )}
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
              "PersonAI 使用相机扫描电脑端展示的配对二维码。你也可以手动粘贴配对链接。",
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
            {t("在电脑端打开配对二维码，对准后自动识别。")}
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
            <View style={styles.stack}>
              <TextField
                label={t("配对链接")}
                value={manualUri}
                onChangeText={setManualUri}
                placeholder="tron://pair?url=https%3A%2F%2F..."
                autoCapitalize="none"
                autoCorrect={false}
                multiline
              />
              <View style={styles.infoCard}>
                <View style={styles.infoRow}>
                  <Ionicons name="shield-checkmark-outline" size={16} color={palette.muted} />
                  <Text style={styles.infoText}>
                    {t(
                      "配对链接包含节点公钥与一次性票据。连接时完成 Noise IK 握手，之后只使用保存在安全存储中的设备密钥。",
                    )}
                  </Text>
                </View>
              </View>
              {error ? <InlineBanner message={error} /> : null}
              <Button
                label={t("连接并保存")}
                icon="link-outline"
                loading={submitting}
                onPress={() => void connectManual()}
                fullWidth
              />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function PairingCard({
  pairing,
  submitting,
  onConnect,
  onRescan,
  error,
}: {
  pairing: PairingInfo;
  submitting: boolean;
  onConnect: () => void;
  onRescan: () => void;
  error: string | null;
}) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { t, format } = useI18n();
  const transportLabel =
    pairing.transport === "public" ? t("公网（WSS）") : t("局域网（WS）");
  const transportTone: "success" | "muted" =
    pairing.transport === "public" ? "success" : "muted";

  return (
    <View style={styles.stack}>
      <Card style={styles.successCard}>
        <View style={styles.successHeader}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={18} color={palette.accent} />
          </View>
          <View style={styles.successTitleBlock}>
            <Text style={styles.successTitle}>{t("已识别配对信息")}</Text>
          </View>
          <Badge label={t("已扫描")} tone="accent" />
        </View>

        <View style={styles.detailList}>
          <DetailRow
            label={t("节点", "singular")}
            value={pairing.machineName || t("未命名电脑")}
          />
          <DetailRow label={t("地址")} value={pairing.baseUrl} mono />
          <DetailRow label={t("传输")} value={transportLabel} />
          <DetailRow
            label={t("产品", "singular")}
            value={`${pairing.productName}（${pairing.productCode}）`}
          />
          <DetailRow label={t("节点 ID")} value={pairing.nodeId} mono />
          <DetailRow label={t("指纹")} value={pairing.keyId} mono />
        </View>

        <View style={styles.scanActions}>
          <Button
            label={t("连接并保存")}
            icon="link-outline"
            loading={submitting}
            onPress={onConnect}
            fullWidth
          />
          <Button
            label={t("重新扫描")}
            icon="scan-outline"
            variant="secondary"
            onPress={onRescan}
            disabled={submitting}
            fullWidth
          />
        </View>
      </Card>

      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Badge
            label={pairing.transport === "public" ? t("公网 WSS + Noise") : t("局域网 WS + Noise")}
            tone={transportTone}
          />
          <Text style={styles.infoText}>
            {format(
              "所有业务请求都在加密通道内通过 RPC 传输，配对票据只用于本次认证。",
              {},
            )}
          </Text>
        </View>
      </View>

      {error ? (
        <InlineBanner
          message={error}
          actionLabel={t("重试")}
          onAction={onConnect}
        />
      ) : null}
    </View>
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
      borderRadius: radius.control,
      gap: spacing.sm,
    },
    infoRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    infoText: {
      flex: 1,
      color: c.muted,
      ...typography.caption,
      fontSize: 11,
      lineHeight: 17,
    },
  });