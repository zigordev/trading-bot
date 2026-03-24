import { useEffect, useMemo, useState } from "react";
import { Image, Text, View } from "react-native";

const GENERIC_ICON_URL =
  "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/32/color/generic.png";

const getAssetIconUrl = (assetCode: string | null | undefined): string => {
  const normalized = assetCode?.trim().toLowerCase();
  if (!normalized) {
    return GENERIC_ICON_URL;
  }

  return `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/32/color/${normalized}.png`;
};

function AssetIcon({
  assetCode,
  size,
  backgroundColor = "#ffffff",
}: {
  assetCode?: string | null;
  size: number;
  backgroundColor?: string;
}) {
  const iconUrl = useMemo(() => getAssetIconUrl(assetCode), [assetCode]);
  const [currentUrl, setCurrentUrl] = useState(iconUrl);
  const [failed, setFailed] = useState(false);
  const fallbackText = (assetCode?.trim().slice(0, 3) || "?").toUpperCase();

  useEffect(() => {
    setCurrentUrl(iconUrl);
    setFailed(false);
  }, [iconUrl]);

  if (failed) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: 999,
          backgroundColor,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: "#d0d5dd",
        }}
      >
        <Text style={{ color: "#344054", fontSize: Math.max(9, size * 0.34), fontWeight: "800" }}>
          {fallbackText}
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: currentUrl }}
      onError={() => {
        if (currentUrl === GENERIC_ICON_URL) {
          setFailed(true);
        } else {
          setCurrentUrl(GENERIC_ICON_URL);
        }
      }}
      onLoad={() => setFailed(false)}
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        backgroundColor,
      }}
    />
  );
}

export function SymbolAvatar({
  baseAsset,
  destinationAsset,
  size = 32,
}: {
  baseAsset?: string | null;
  destinationAsset?: string | null;
  size?: number;
}) {
  const quoteSize = Math.max(14, Math.round(size * 0.48));

  return (
    <View
      style={{
        width: size + Math.round(quoteSize * 0.42),
        height: size,
        justifyContent: "center",
      }}
    >
      <AssetIcon assetCode={baseAsset} size={size} />
      <View
        style={{
          position: "absolute",
          right: 0,
          bottom: -1,
          width: quoteSize + 4,
          height: quoteSize + 4,
          borderRadius: 999,
          backgroundColor: "#ffffff",
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: "#d0d5dd",
        }}
      >
        <AssetIcon
          assetCode={destinationAsset}
          size={quoteSize}
          backgroundColor="#ffffff"
        />
      </View>
    </View>
  );
}
