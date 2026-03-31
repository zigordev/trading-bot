import { MaterialIcons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppShell } from "@/src/components/app-shell";
import { Card } from "@/src/components/card";
import { MultiSelectFilter } from "@/src/components/multi-select-filter";
import { SymbolAvatar } from "@/src/components/symbol-avatar";
import {
  deleteConfigResource,
  getBinanceSymbolReferences,
  getConfigResourceRecords,
  saveConfigResource,
} from "@/src/lib/api";
import {
  type ConfigField,
  configResources,
  createEmptyFormState,
  serializeConfigPayload,
  type ConfigResourceKey,
} from "@/src/lib/configuration";
import { subscribeOpsRealtimeEvent } from "@/src/lib/ops-events";

export default function ConfigurationScreen() {
  const queryClient = useQueryClient();
  const [resourceKey, setResourceKey] = useState<ConfigResourceKey>("symbols");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    resourceKey: ConfigResourceKey;
    record: Record<string, unknown>;
  } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [symbolReferenceSearch, setSymbolReferenceSearch] = useState("");
  const [formState, setFormState] = useState<Record<string, string>>(
    createEmptyFormState("symbols"),
  );
  const resource = configResources[resourceKey];

  useEffect(() => {
    setEditingId(null);
    setPendingDelete(null);
    setShowForm(false);
    setSymbolReferenceSearch("");
    setFormState(createEmptyFormState(resourceKey));
  }, [resourceKey]);

  useEffect(
    () =>
      subscribeOpsRealtimeEvent((event) => {
        if (
          event.type === "config.resource.updated" &&
          event.payload.resource === resourceKey
        ) {
          void queryClient.invalidateQueries({ queryKey: ["config-resource", resourceKey] });
        }
      }),
    [queryClient, resourceKey],
  );

  const recordsQuery = useQuery({
    queryKey: ["config-resource", resourceKey],
    queryFn: () => getConfigResourceRecords(resourceKey),
  });
  const symbolReferencesQuery = useQuery({
    queryKey: ["binance-symbol-references", symbolReferenceSearch],
    queryFn: () => getBinanceSymbolReferences(symbolReferenceSearch),
    enabled: showForm && resourceKey === "symbols",
  });

  const saveMutation = useMutation({
    mutationFn: async () =>
      saveConfigResource(
        resourceKey,
        serializeConfigPayload(resource.fields, formState),
        editingId,
      ),
    onSuccess: async () => {
      setEditingId(null);
      setShowForm(false);
      setSymbolReferenceSearch("");
      setFormState(createEmptyFormState(resourceKey));
      await queryClient.invalidateQueries({ queryKey: ["config-resource", resourceKey] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({
      resourceKey: deleteResourceKey,
      id,
    }: {
      resourceKey: ConfigResourceKey;
      id: string;
    }) => deleteConfigResource(deleteResourceKey, id),
    onSuccess: async () => {
      const deletedResourceKey = deleteMutation.variables?.resourceKey;
      setPendingDelete(null);
      if (deletedResourceKey) {
        await queryClient.invalidateQueries({
          queryKey: ["config-resource", deletedResourceKey],
        });
      }
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({
      id,
      record,
      field,
      nextValue,
    }: {
      id: string;
      record: Record<string, unknown>;
      field: string;
      nextValue: boolean;
    }) =>
      saveConfigResource(
        resourceKey,
        buildEditablePayload(resource.fields, record, field, nextValue),
        id,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["config-resource", resourceKey] });
    },
  });

  return (
    <AppShell>
      <View style={{ gap: 0 }}>
        <View
          style={{
            marginHorizontal: -24,
            marginTop: -20,
          }}
        >
          <View
            style={{
              width: "100%",
              backgroundColor: "#dbe2ea",
              paddingHorizontal: 24,
              paddingVertical: 10,
            }}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                minWidth: "100%",
                paddingRight: 8,
              }}
            >
              {Object.entries(configResources).map(([key, value]) => (
                <Pressable
                  key={key}
                  onPress={() => setResourceKey(key as ConfigResourceKey)}
                  style={{
                    borderRadius: 10,
                    borderWidth: 0,
                    backgroundColor: key === resourceKey ? "#1f3a5f" : "transparent",
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <MaterialIcons
                    name={configurationIconByResourceKey[key as ConfigResourceKey]}
                    size={18}
                    color={key === resourceKey ? "#ffffff" : "#344054"}
                  />
                  <Text
                    style={{
                      color: key === resourceKey ? "#ffffff" : "#344054",
                      fontWeight: "700",
                    }}
                  >
                    {value.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>

        <View style={{ gap: 12, paddingTop: 16 }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <Pressable
              onPress={() => {
                setEditingId(null);
                setShowForm((current) => {
                  const next = !current;
                  if (next) {
                    setSymbolReferenceSearch("");
                    setFormState(createEmptyFormState(resourceKey));
                  }
                  return next;
                });
              }}
              style={primaryButtonStyle}
            >
              <Text style={{ color: "#ffffff", fontWeight: "700" }}>
                {showForm && !editingId ? "Close form" : "+ Add"}
              </Text>
            </Pressable>
          </View>
          <View style={{ gap: 12 }}>
            {recordsQuery.data?.map((record) => (
              <View
                key={String(record.id)}
                style={{
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: "#eaecf0",
                  backgroundColor: "#ffffff",
                  padding: 14,
                  gap: 10,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    {resourceKey === "symbols" ? (
                      <SymbolAvatar
                        baseAsset={String(record.baseAsset ?? "")}
                        destinationAsset={String(record.destinationAsset ?? "")}
                        size={34}
                      />
                    ) : null}
                    <Text style={{ fontWeight: "700", color: "#101828", fontSize: 16 }}>
                      {record[resource.titleField]
                        ? String(record[resource.titleField])
                        : String(record.id)}
                    </Text>
                    <RecordSummary resourceKey={resourceKey} record={record} />
                  </View>
                  <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                    <RecordToggle
                      resourceKey={resourceKey}
                      record={record}
                      onToggle={(field, nextValue) =>
                        toggleMutation.mutate({
                          id: String(record.id),
                          record,
                          field,
                          nextValue,
                        })
                      }
                      togglePendingField={
                        toggleMutation.isPending &&
                        toggleMutation.variables?.id === String(record.id)
                          ? toggleMutation.variables.field
                          : null
                      }
                    />
                    <Pressable
                      onPress={() => {
                        setEditingId(String(record.id));
                        setShowForm(true);
                        setSymbolReferenceSearch(String(record.code ?? ""));
                        setFormState(createFormStateFromRecord(resource.fields, record));
                      }}
                      style={secondaryButtonStyle}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <MaterialIcons name="edit" size={16} color="#344054" />
                        <Text style={{ color: "#344054", fontWeight: "700" }}>Edit</Text>
                      </View>
                    </Pressable>
                    <Pressable
                      onPress={() => setPendingDelete({ resourceKey, record })}
                      style={dangerButtonStyle}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <MaterialIcons name="delete" size={16} color="#ffffff" />
                        <Text style={{ color: "#ffffff", fontWeight: "700" }}>Delete</Text>
                      </View>
                    </Pressable>
                  </View>
                </View>
              </View>
            )) ?? <Text style={{ color: "#475467" }}>Loading records…</Text>}
          </View>
        </View>
      </View>

      <Modal
        visible={showForm}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setEditingId(null);
          setShowForm(false);
          setFormState(createEmptyFormState(resourceKey));
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(16, 24, 40, 0.45)",
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <View
            style={{
              width: "100%",
              maxWidth: 720,
              maxHeight: "85%",
            }}
          >
            <Card>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <Text style={{ fontSize: 20, fontWeight: "700", color: "#101828" }}>
                  {editingId ? `Edit ${resource.label}` : `Create ${resource.label}`}
                </Text>
                <Pressable
                  onPress={() => {
                    setEditingId(null);
                    setShowForm(false);
                    setFormState(createEmptyFormState(resourceKey));
                  }}
                  style={secondaryButtonStyle}
                >
                  <Text style={{ color: "#344054", fontWeight: "700" }}>Close</Text>
                </Pressable>
              </View>

              <ScrollView style={{ marginTop: 12 }} contentContainerStyle={{ gap: 10 }}>
                {resourceKey === "symbols" ? (
                  <BinanceSymbolPicker
                    search={symbolReferenceSearch}
                    onSearchChange={setSymbolReferenceSearch}
                    loading={symbolReferencesQuery.isLoading}
                    options={symbolReferencesQuery.data ?? []}
                    onSelect={(option) => {
                      setFormState((current) => ({
                        ...current,
                        code: option.symbol,
                        baseAsset: option.baseAsset,
                        destinationAsset: option.destinationAsset,
                      }));
                    }}
                  />
                ) : null}
                {resource.fields
                  .filter((field) => field.kind !== "boolean")
                  .map((field) => (
                  <FieldInput
                    key={field.name}
                    field={field}
                    value={formState[field.name] ?? ""}
                    onChange={(value) =>
                      setFormState((current) => ({
                        ...current,
                        [field.name]: value,
                      }))
                    }
                  />
                ))}

                <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
                  <Pressable onPress={() => saveMutation.mutate()} style={primaryButtonStyle}>
                    <Text style={{ color: "#ffffff", fontWeight: "700" }}>
                      {saveMutation.isPending
                        ? "Saving…"
                        : editingId
                          ? "Update"
                          : "Create"}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                    setEditingId(null);
                    setShowForm(false);
                    setSymbolReferenceSearch("");
                    setFormState(createEmptyFormState(resourceKey));
                  }}
                    style={secondaryButtonStyle}
                  >
                    <Text style={{ color: "#344054", fontWeight: "700" }}>Cancel</Text>
                  </Pressable>
                </View>

                {saveMutation.isError ? (
                  <Text style={{ color: "#b42318" }}>
                    {(saveMutation.error as Error).message}
                  </Text>
                ) : null}
              </ScrollView>
            </Card>
          </View>
        </View>
      </Modal>

      <Modal
        visible={pendingDelete !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingDelete(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(16, 24, 40, 0.45)",
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <View style={{ width: "100%", maxWidth: 520 }}>
            <Card>
              <View style={{ gap: 12 }}>
                <Text style={{ fontSize: 20, fontWeight: "700", color: "#101828" }}>
                  Confirm delete
                </Text>
                <Text style={{ color: "#475467", lineHeight: 20 }}>
                  Delete{" "}
                  <Text style={{ fontWeight: "700", color: "#101828" }}>
                    {pendingDelete?.record[configResources[pendingDelete.resourceKey].titleField]
                      ? String(
                          pendingDelete.record[
                            configResources[pendingDelete.resourceKey].titleField
                          ],
                        )
                      : pendingDelete?.record.id
                        ? String(pendingDelete.record.id)
                        : "this record"}
                  </Text>
                  ?
                </Text>
                <View style={{ flexDirection: "row", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <Pressable
                    onPress={() => setPendingDelete(null)}
                    style={secondaryButtonStyle}
                  >
                    <Text style={{ color: "#344054", fontWeight: "700" }}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      if (pendingDelete?.record.id) {
                        deleteMutation.mutate({
                          resourceKey: pendingDelete.resourceKey,
                          id: String(pendingDelete.record.id),
                        });
                      }
                    }}
                    style={dangerButtonStyle}
                  >
                    <Text style={{ color: "#ffffff", fontWeight: "700" }}>
                      {deleteMutation.isPending ? "Deleting..." : "Confirm"}
                    </Text>
                  </Pressable>
                </View>
                {deleteMutation.isError ? (
                  <Text style={{ color: "#b42318" }}>
                    {(deleteMutation.error as Error).message}
                  </Text>
                ) : null}
              </View>
            </Card>
          </View>
        </View>
      </Modal>
    </AppShell>
  );
}

function BinanceSymbolPicker({
  search,
  onSearchChange,
  loading,
  options,
  onSelect,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  loading: boolean;
  options: Array<{ symbol: string; baseAsset: string; destinationAsset: string }>;
  onSelect: (option: { symbol: string; baseAsset: string; destinationAsset: string }) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: "#344054", fontWeight: "600" }}>Search Binance symbol</Text>
      <TextInput
        value={search}
        onChangeText={onSearchChange}
        placeholder="BTCUSDT, BTC, USDT..."
        autoCapitalize="characters"
        autoCorrect={false}
        style={inputStyle}
      />
      <View
        style={{
          borderRadius: 14,
          borderWidth: 1,
          borderColor: "#d0d5dd",
          backgroundColor: "#ffffff",
          maxHeight: 220,
          overflow: "hidden",
        }}
      >
        <ScrollView contentContainerStyle={{ padding: 8, gap: 6 }}>
          {loading ? (
            <Text style={{ color: "#475467", paddingHorizontal: 6, paddingVertical: 4 }}>
              Loading Binance symbols...
            </Text>
          ) : options.length === 0 ? (
            <Text style={{ color: "#475467", paddingHorizontal: 6, paddingVertical: 4 }}>
              No Binance symbols match the current search.
            </Text>
          ) : (
            options.map((option) => (
              <Pressable
                key={option.symbol}
                onPress={() => onSelect(option)}
                style={{
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#eaecf0",
                  backgroundColor: "#f8fafc",
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <SymbolAvatar
                    baseAsset={option.baseAsset}
                    destinationAsset={option.destinationAsset}
                    size={28}
                  />
                  <View>
                    <Text style={{ color: "#101828", fontWeight: "700" }}>{option.symbol}</Text>
                    <Text style={{ color: "#475467" }}>
                      {option.baseAsset} / {option.destinationAsset}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="north-west" size={18} color="#475467" />
              </Pressable>
            ))
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function buildEditablePayload(
  fields: ConfigField[],
  record: Record<string, unknown>,
  field: string,
  nextValue: boolean,
): Record<string, unknown> {
  const payload = fields.reduce<Record<string, unknown>>((accumulator, currentField) => {
    accumulator[currentField.name] = record[currentField.name];
    return accumulator;
  }, {});

  payload[field] = nextValue;
  return payload;
}

const configurationIconByResourceKey: Record<ConfigResourceKey, keyof typeof MaterialIcons.glyphMap> = {
  symbols: "currency-bitcoin",
  timeframes: "schedule",
  strategies: "insights",
  "risk-profiles": "shield",
  "analysis-settings": "analytics",
  "execution-settings": "play-circle-outline",
};

function RecordSummary({
  resourceKey,
  record,
}: {
  resourceKey: ConfigResourceKey;
  record: Record<string, unknown>;
}) {
  if (resourceKey === "symbols") {
    return (
      <Text style={{ color: "#475467" }}>
        {String(record.baseAsset ?? "n/a")} / {String(record.destinationAsset ?? "n/a")}
      </Text>
    );
  }

  if (resourceKey === "timeframes") {
    return null;
  }

  if (resourceKey === "strategies") {
    return (
      record.description ? <Text style={{ color: "#475467" }}>{String(record.description)}</Text> : null
    );
  }

  if (resourceKey === "risk-profiles") {
    return (
      <Text style={{ color: "#475467" }}>
        RRR: {String(record.rrr ?? "n/a")}
      </Text>
    );
  }

  if (resourceKey === "analysis-settings") {
    return (
      <View style={{ gap: 8 }}>
        <Text style={{ color: "#475467" }}>
          {String(record.name ?? "n/a")}
        </Text>
        <Text style={{ color: "#475467" }}>
          Strategy: {String(record.strategyName ?? "n/a")}
        </Text>
      </View>
    );
  }

  if (resourceKey === "execution-settings") {
    return (
      <View style={{ gap: 8 }}>
        <Text style={{ color: "#475467" }}>
          Mode: {String(record.mode ?? "paper")}
        </Text>
      </View>
    );
  }

  return null;
}

function RecordToggle({
  resourceKey,
  record,
  onToggle,
  togglePendingField,
}: {
  resourceKey: ConfigResourceKey;
  record: Record<string, unknown>;
  onToggle: (field: string, nextValue: boolean) => void;
  togglePendingField: string | null;
}) {
  if (resourceKey === "symbols" || resourceKey === "timeframes") {
    const field = "active";
    const active = Boolean(record[field]);
    return (
      <BooleanToggle
        label=""
        value={active}
        pending={togglePendingField === field}
        onPress={() => onToggle(field, !active)}
      />
    );
  }

  if (resourceKey === "strategies") {
    return (
      <BooleanToggle
        label=""
        value={Boolean(record.activated)}
        pending={togglePendingField === "activated"}
        onPress={() => onToggle("activated", !Boolean(record.activated))}
      />
    );
  }

  if (
    resourceKey === "risk-profiles" ||
    resourceKey === "analysis-settings" ||
    resourceKey === "execution-settings"
  ) {
    return (
      <BooleanToggle
        label=""
        value={Boolean(record.enabled)}
        pending={togglePendingField === "enabled"}
        onPress={() => onToggle("enabled", !Boolean(record.enabled))}
      />
    );
  }

  return null;
}

function BooleanToggle({
  label,
  value,
  pending,
  onPress,
}: {
  label: string;
  value: boolean;
  pending?: boolean;
  onPress: () => void;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      {label ? <Text style={{ color: "#344054", fontWeight: "600" }}>{label}</Text> : null}
      <Pressable
        onPress={onPress}
        disabled={pending}
        accessibilityRole="switch"
        accessibilityState={{ checked: value, disabled: pending }}
        style={{
          width: 46,
          height: 28,
          borderRadius: 999,
          padding: 3,
          justifyContent: "center",
          backgroundColor: value ? "#12b76a" : "#d0d5dd",
          opacity: pending ? 0.6 : 1,
        }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 999,
            backgroundColor: "#ffffff",
            alignSelf: value ? "flex-end" : "flex-start",
          }}
        />
      </Pressable>
      {pending ? <Text style={{ color: "#475467" }}>Saving...</Text> : null}
    </View>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: ConfigField;
  value: string;
  onChange: (value: string) => void;
}) {
  if (field.kind === "boolean") {
    const enabled = value === "true";
    return (
      <View style={{ gap: 6 }}>
        <Text style={{ color: "#344054", fontWeight: "600" }}>{field.label}</Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {["true", "false"].map((option) => (
            <Pressable
              key={option}
              onPress={() => onChange(option)}
              style={{
                borderRadius: 999,
                borderWidth: 1,
                borderColor:
                  value === option ? "#101828" : "#d0d5dd",
                backgroundColor:
                  value === option ? "#101828" : "#ffffff",
                paddingHorizontal: 14,
                paddingVertical: 10,
              }}
            >
              <Text
                style={{
                  color: value === option ? "#ffffff" : "#344054",
                  fontWeight: "600",
                }}
              >
                {option === "true" ? "True" : "False"}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={{ color: enabled ? "#157f3b" : "#b54708" }}>
          Current: {enabled ? "True" : "False"}
        </Text>
      </View>
    );
  }

  if (field.options && field.options.length > 0) {
    return (
      <View style={{ gap: 6 }}>
        <MultiSelectFilter
          label={field.label}
          value={value ? [value] : []}
          options={field.options}
          allLabel={`Select ${field.label.toLowerCase()}`}
          allowEmpty={false}
          onChange={(values) => onChange(values.at(-1) ?? "")}
        />
      </View>
    );
  }

  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: "#344054", fontWeight: "600" }}>{field.label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={field.placeholder}
        keyboardType={field.kind === "number" ? "numeric" : "default"}
        multiline={field.kind === "json"}
        style={[
          inputStyle,
          field.kind === "json" ? { minHeight: 120, textAlignVertical: "top" } : null,
        ]}
      />
    </View>
  );
}

function createFormStateFromRecord(
  fields: ConfigField[],
  record: Record<string, unknown>,
): Record<string, string> {
  return fields.reduce<Record<string, string>>((accumulator, field) => {
    const value = record[field.name];
    if (field.kind === "json") {
      accumulator[field.name] = JSON.stringify(value ?? {}, null, 2);
    } else if (field.kind === "boolean") {
      accumulator[field.name] = String(Boolean(value));
    } else if (value === null || value === undefined) {
      accumulator[field.name] = "";
    } else {
      accumulator[field.name] = String(value);
    }
    return accumulator;
  }, {});
}

const inputStyle = {
  borderRadius: 14,
  borderWidth: 1,
  borderColor: "#d0d5dd",
  backgroundColor: "#ffffff",
  paddingHorizontal: 14,
  paddingVertical: 12,
} as const;

const primaryButtonStyle = {
  borderRadius: 14,
  backgroundColor: "#101828",
  alignItems: "center" as const,
  paddingHorizontal: 14,
  paddingVertical: 12,
} as const;

const secondaryButtonStyle = {
  borderRadius: 14,
  borderWidth: 1,
  borderColor: "#bfd3ea",
  alignItems: "center" as const,
  paddingHorizontal: 14,
  paddingVertical: 12,
  backgroundColor: "#eef4fb",
} as const;

const dangerButtonStyle = {
  borderRadius: 14,
  backgroundColor: "#b42318",
  alignItems: "center" as const,
  paddingHorizontal: 14,
  paddingVertical: 12,
} as const;
