import { MaterialIcons } from "@expo/vector-icons";
import { Link, usePathname } from "expo-router";
import type { ReactNode } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";

const navItems = [
  { href: "/", label: "Overview", icon: "dashboard" as const },
  {
    href: "/configuration",
    label: "Configuration",
    icon: "settings" as const,
  },
  { href: "/backtesting", label: "Backtesting", icon: "history" as const },
  { href: "/execution", label: "Execution", icon: "candlestick-chart" as const },
] as const;

export function AppShell({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#f5f7fa" }}
      contentContainerStyle={{ paddingBottom: 24 }}
    >
      <View
        style={{
          backgroundColor: "#101828",
          paddingTop: 16,
          paddingBottom: 14,
          paddingHorizontal: 24,
          width: "100%",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            flexWrap: "nowrap",
            width: "100%",
          }}
        >
          <View
            style={{
              alignItems: "center",
              justifyContent: "center",
              width: 58,
              height: 58,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: "#475467",
              backgroundColor: "#ffffff",
              flexShrink: 0,
              overflow: "hidden",
            }}
          >
            <Image
              source={require("@/src/assets/logo.png")}
              style={{ width: 90, height: 90 }}
              resizeMode="contain"
            />
          </View>

          <View style={{ flex: 1, minWidth: 0 }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                flexDirection: "row",
                gap: 10,
                alignItems: "center",
                paddingRight: 8,
              }}
            >
              {navItems.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === item.href
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link key={item.href} href={item.href} asChild>
                    <Pressable
                      style={{
                        borderRadius: 10,
                        borderWidth: 0,
                        backgroundColor: active ? "#1f3a5f" : "transparent",
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <MaterialIcons
                        name={item.icon}
                        size={18}
                        color={active ? "#dbeafe" : "#f8fafc"}
                      />
                      <Text
                        style={{
                          color: active ? "#dbeafe" : "#f8fafc",
                          fontWeight: "700",
                        }}
                      >
                        {item.label}
                      </Text>
                    </Pressable>
                  </Link>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </View>

      <View style={{ paddingHorizontal: 24, paddingTop: 20 }}>
        {children}
      </View>
    </ScrollView>
  );
}
