import { MaterialIcons } from "@expo/vector-icons";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Modal,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

const FILTER_TRIGGER_MIN_WIDTH = 152;
const FILTER_PANEL_MIN_WIDTH = 220;

export function MultiSelectFilter({
  label,
  value,
  options,
  onChange,
  allLabel,
  allowEmpty = true,
  renderOptionAdornment,
  hideOptionText = false,
  hideSelectedSummaryText = false,
  hideSelectedAdornment = false,
}: {
  label: string;
  value: string[];
  options: string[];
  onChange: (value: string[]) => void;
  allLabel: string;
  allowEmpty?: boolean;
  renderOptionAdornment?: (option: string) => ReactNode;
  hideOptionText?: boolean;
  hideSelectedSummaryText?: boolean;
  hideSelectedAdornment?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [anchor, setAnchor] = useState({
    x: 0,
    y: 0,
    width: FILTER_TRIGGER_MIN_WIDTH,
    height: 0,
  });
  const triggerRef = useRef<View | null>(null);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const updateAnchorWidth = (event: LayoutChangeEvent) => {
    const nextWidth = Math.max(
      FILTER_TRIGGER_MIN_WIDTH,
      event.nativeEvent.layout.width,
    );
    setAnchor((current) =>
      current.width === nextWidth ? current : { ...current, width: nextWidth },
    );
  };

  const filteredOptions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) {
      return options;
    }

    return options.filter((option) => option.toLowerCase().includes(normalizedSearch));
  }, [options, search]);

  const toggleValue = (nextValue: string) => {
    if (value.includes(nextValue)) {
      const nextSelection = value.filter((item) => item !== nextValue);
      if (!allowEmpty && nextSelection.length === 0) {
        return;
      }
      onChange(nextSelection);
      return;
    }

    onChange([...value, nextValue]);
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

  const panelWidth = Math.min(
    Math.max(anchor.width, Math.min(FILTER_PANEL_MIN_WIDTH, windowWidth - 32)),
    420,
  );
  const panelLeft = Math.max(16, Math.min(anchor.x, windowWidth - panelWidth - 16));
  const panelTop = Math.min(anchor.y + anchor.height + 8, windowHeight - 460);

  return (
    <View ref={triggerRef} collapsable={false} onLayout={updateAnchorWidth}>
      <Pressable
        onPress={() => {
          if (open) {
            setOpen(false);
            return;
          }
          openDropdown();
        }}
        style={{
          minWidth: FILTER_TRIGGER_MIN_WIDTH,
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
            {value.length === 1 && renderOptionAdornment && !hideSelectedAdornment
              ? renderOptionAdornment(value[0])
              : null}
            {!(hideSelectedSummaryText && value.length === 1) ? (
              <Text numberOfLines={1} style={{ color: "#101828", fontWeight: "600", flex: 1 }}>
                {summary}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {allowEmpty && value.length > 0 ? (
            <Pressable
              onPress={(event) => {
                event.stopPropagation();
                onChange([]);
              }}
              hitSlop={8}
              style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#f2f4f7",
              }}
            >
              <MaterialIcons name="close" size={14} color="#475467" />
            </Pressable>
          ) : null}
          <MaterialIcons name="arrow-drop-down" size={20} color="#344054" />
        </View>
      </Pressable>
      {value.length > 0 ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 8,
            height: 8,
            borderRadius: 999,
            backgroundColor: "#175cd3",
            borderWidth: 1,
            borderColor: "#ffffff",
          }}
        />
      ) : null}

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
                        {!hideOptionText ? (
                          <Text
                            style={{
                              color: selected ? "#ffffff" : "#344054",
                              fontWeight: "700",
                            }}
                          >
                            {option}
                          </Text>
                        ) : null}
                      </View>
                      {selected ? (
                        <MaterialIcons name="check" size={18} color="#ffffff" />
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}
