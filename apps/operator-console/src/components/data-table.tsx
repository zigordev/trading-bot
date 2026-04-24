import type { ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type DimensionValue,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

type Align = "left" | "right";

export function ResponsiveDataTable({
  children,
  width = "100%",
  minWidth,
  scrollStyle,
  contentStyle,
  showsHorizontalScrollIndicator = false,
}: {
  children: ReactNode;
  width?: DimensionValue;
  minWidth?: number;
  scrollStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  showsHorizontalScrollIndicator?: boolean;
}) {
  const resolvedMinWidth = minWidth ?? (typeof width === "number" ? width : undefined);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={showsHorizontalScrollIndicator}
      style={scrollStyle}
      contentContainerStyle={{ minWidth: "100%" }}
    >
      <View
        style={[
          {
            width,
            minWidth: resolvedMinWidth,
            gap: 0,
          },
          contentStyle,
        ]}
      >
        {children}
      </View>
    </ScrollView>
  );
}

export function DataTableSurface({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          borderWidth: 1,
          borderColor: "#eaecf0",
          borderRadius: 18,
          overflow: "hidden",
          backgroundColor: "#ffffff",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function DataTableHeaderRow({
  children,
  paddingHorizontal = 14,
  paddingVertical = 12,
  gap = 12,
}: {
  children: ReactNode;
  paddingHorizontal?: number;
  paddingVertical?: number;
  gap?: number;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        width: "100%",
        backgroundColor: "#f8fafc",
        paddingHorizontal,
        paddingVertical,
        gap,
      }}
    >
      {children}
    </View>
  );
}

export function DataTableRow({
  children,
  index,
  paddingHorizontal = 14,
  paddingVertical = 12,
  gap = 12,
  alignItems = "flex-start",
  direction = "row",
}: {
  children: ReactNode;
  index: number;
  paddingHorizontal?: number;
  paddingVertical?: number;
  gap?: number;
  alignItems?: "flex-start" | "center";
  direction?: "row" | "column";
}) {
  return (
    <View
      style={{
        flexDirection: direction,
        width: "100%",
        paddingHorizontal,
        paddingVertical,
        gap,
        borderTopWidth: 1,
        borderTopColor: "#eaecf0",
        backgroundColor: index % 2 === 0 ? "#ffffff" : "#fcfcfd",
        alignItems,
      }}
    >
      {children}
    </View>
  );
}

export function DataTableHeaderCell({
  label,
  flex,
  minWidth,
  align = "left",
  paddingRight = 8,
  accessory,
  onPress,
}: {
  label: string;
  flex: number;
  minWidth?: number;
  align?: Align;
  paddingRight?: number;
  accessory?: ReactNode;
  onPress?: () => void;
}) {
  const content = (
    <>
      <Text
        numberOfLines={1}
        style={{
          color: "#475467",
          fontWeight: "700",
          fontSize: 12,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
      {accessory ?? null}
    </>
  );

  const style: ViewStyle = {
    flex,
    minWidth,
    paddingRight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: align === "right" ? "flex-end" : "flex-start",
    gap: 6,
  };

  if (!onPress) {
    return <View style={style}>{content}</View>;
  }

  return (
    <Pressable onPress={onPress} style={style}>
      {content}
    </Pressable>
  );
}

export function DataTableTextCell({
  label,
  flex,
  minWidth,
  align = "left",
  color = "#101828",
  weight = "500",
  numberOfLines = 1,
  paddingRight = 8,
  textStyle,
}: {
  label: string;
  flex: number;
  minWidth?: number;
  align?: Align;
  color?: string;
  weight?: TextStyle["fontWeight"];
  numberOfLines?: number;
  paddingRight?: number;
  textStyle?: StyleProp<TextStyle>;
}) {
  return (
    <View
      style={{
        flex,
        minWidth,
        paddingRight,
        alignItems: align === "right" ? "flex-end" : "flex-start",
      }}
    >
      <Text
        numberOfLines={numberOfLines}
        style={[
          {
            color,
            fontWeight: weight,
            textAlign: align,
          },
          textStyle,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

export function DataTableEmptyState({
  message,
}: {
  message: string;
}) {
  return (
    <View
      style={{
        paddingVertical: 28,
        paddingHorizontal: 18,
        borderTopWidth: 1,
        borderTopColor: "#eaecf0",
        backgroundColor: "#fcfcfd",
      }}
    >
      <Text style={{ color: "#475467" }}>{message}</Text>
    </View>
  );
}

export function DataTableFooter({
  currentPage,
  totalPages,
  totalCount,
  itemLabel,
  onPrevious,
  onNext,
}: {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  itemLabel: string;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 12,
        borderTopWidth: 1,
        borderTopColor: "#eaecf0",
        backgroundColor: "#f8fafc",
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
    >
      <Text style={{ color: "#475467" }}>
        Page {currentPage} of {totalPages} · {totalCount.toLocaleString()} {itemLabel}
      </Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <PaginationButton
          label="Previous"
          disabled={currentPage <= 1}
          onPress={onPrevious}
        />
        <PaginationButton
          label="Next"
          disabled={currentPage >= totalPages}
          onPress={onNext}
        />
      </View>
    </View>
  );
}

function PaginationButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        borderRadius: 10,
        borderWidth: 1,
        borderColor: disabled ? "#eaecf0" : "#d0d5dd",
        backgroundColor: disabled ? "#f2f4f7" : "#ffffff",
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}
    >
      <Text style={{ color: disabled ? "#98a2b3" : "#344054", fontWeight: "700" }}>
        {label}
      </Text>
    </Pressable>
  );
}
