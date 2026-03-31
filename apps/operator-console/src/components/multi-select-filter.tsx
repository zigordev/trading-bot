import { MaterialIcons } from "@expo/vector-icons";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

export function MultiSelectFilter({
  label,
  value,
  options,
  onChange,
  allLabel,
  allowEmpty = true,
  renderOptionAdornment,
}: {
  label: string;
  value: string[];
  options: string[];
  onChange: (value: string[]) => void;
  allLabel: string;
  allowEmpty?: boolean;
  renderOptionAdornment?: (option: string) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [anchor, setAnchor] = useState({ x: 0, y: 0, width: 320, height: 0 });
  const triggerRef = useRef<View | null>(null);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const filteredOptions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) {
      return options;
    }

    return options.filter((option) => option.toLowerCase().includes(normalizedSearch));
  }, [options, search]);

  const toggleValue = (nextValue: string) => {
    onChange(
      value.includes(nextValue)
        ? value.filter((item) => item !== nextValue)
        : [...value, nextValue],
    );
  };

  const openDropdown = () => {
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setSearch("");
      setOpen(true);
    });
  };

  const summary =
    value.length === 0 ? allLabel : value.length === 1 ? value[0] : `${value.length} selected`;

  const panelWidth = Math.min(Math.max(anchor.width, 320), 420);
  const panelLeft = Math.max(16, Math.min(anchor.x, windowWidth - panelWidth - 16));
  const panelTop = Math.min(anchor.y + anchor.height + 8, windowHeight - 460);

  return (
    <View ref={triggerRef} collapsable={false}>
      <Pressable
        onPress={() => {
          if (open) {
            setOpen(false);
            return;
          }
          openDropdown();
        }}
        style={{
          minWidth: 180,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: "#cbd5e1",
          backgroundColor: "#ffffff",
          paddingHorizontal: 12,
          paddingVertical: 10,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <View style={{ gap: 2, flex: 1 }}>
          <Text style={{ fontSize: 12, fontWeight: "700", color: "#475467" }}>{label}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {value.length === 1 && renderOptionAdornment ? renderOptionAdornment(value[0]) : null}
            <Text style={{ color: "#101828", fontWeight: "600" }}>{summary}</Text>
          </View>
        </View>
        <MaterialIcons name="arrow-drop-down" size={20} color="#344054" />
      </Pressable>

      {open ? (
        <Modal transparent visible animationType="none" onRequestClose={() => setOpen(false)}>
          <Pressable
            onPress={() => setOpen(false)}
            style={{
              flex: 1,
              backgroundColor: "transparent",
            }}
          >
            <Pressable
              onPress={(event) => event.stopPropagation()}
              style={{
                position: "absolute",
                top: panelTop,
                left: panelLeft,
                width: panelWidth,
                maxHeight: 420,
                borderRadius: 18,
                backgroundColor: "#ffffff",
                padding: 18,
                gap: 12,
                borderWidth: 1,
                borderColor: "#d0d5dd",
                shadowColor: "#101828",
                shadowOffset: { width: 0, height: 16 },
                shadowOpacity: 0.12,
                shadowRadius: 24,
                elevation: 12,
              }}
            >
              <Text style={{ fontSize: 18, fontWeight: "700", color: "#101828" }}>{label}</Text>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder={`Search ${label.toLowerCase()}`}
                placeholderTextColor="#98a2b3"
                style={{
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#d0d5dd",
                  backgroundColor: "#f8fafc",
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  color: "#101828",
                  fontWeight: "600",
                }}
              />
              <ScrollView contentContainerStyle={{ gap: 8 }}>
                {allowEmpty ? (
                  <Pressable
                    onPress={() => onChange([])}
                    style={{
                      borderRadius: 12,
                      backgroundColor: value.length === 0 ? "#1f3a5f" : "#f8fafc",
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                    }}
                  >
                    <Text
                      style={{
                        color: value.length === 0 ? "#ffffff" : "#344054",
                        fontWeight: "700",
                      }}
                    >
                      {allLabel}
                    </Text>
                  </Pressable>
                ) : null}

                {filteredOptions.map((option) => {
                  const selected = value.includes(option);
                  return (
                    <Pressable
                      key={option}
                      onPress={() => toggleValue(option)}
                      style={{
                        borderRadius: 12,
                        backgroundColor: selected ? "#1f3a5f" : "#f8fafc",
                        paddingHorizontal: 14,
                        paddingVertical: 12,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        {renderOptionAdornment ? renderOptionAdornment(option) : null}
                        <Text
                          style={{
                            color: selected ? "#ffffff" : "#344054",
                            fontWeight: "700",
                          }}
                        >
                          {option}
                        </Text>
                      </View>
                      {selected ? (
                        <MaterialIcons name="check" size={18} color="#ffffff" />
                      ) : null}
                    </Pressable>
                  );
                })}

                {filteredOptions.length === 0 ? (
                  <Text style={{ color: "#667085", paddingHorizontal: 4, paddingVertical: 8 }}>
                    No options match the current search.
                  </Text>
                ) : null}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}
