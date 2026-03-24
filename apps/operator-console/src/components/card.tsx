import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View
      style={{
        borderRadius: 24,
        backgroundColor: "#ffffff",
        borderWidth: 1,
        borderColor: "#eaecf0",
        padding: 18,
        gap: 8,
        ...(style ?? {}),
      }}
    >
      {children}
    </View>
  );
}
