"use client";

import * as React from "react";
import {
  useForm,
  Controller,
  FormProvider,
  useFormContext,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DetailSheet } from "@/components/shared/detail-sheet";
import { AssetLabel } from "@/components/shared/symbol-avatar";
import {
  type ConfigField,
  type ConfigResourceDefinition,
} from "@/lib/configuration/schemas";
import { useSaveConfigResource } from "@/lib/hooks/use-config-resource";
import { BinanceSymbolCombobox } from "./binance-symbol-combobox";

interface ConfigFormSheetProps {
  resource: ConfigResourceDefinition;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: Record<string, unknown> | null;
}

export function ConfigFormSheet({
  resource,
  open,
  onOpenChange,
  initial,
}: ConfigFormSheetProps) {
  const isEdit = Boolean(initial);
  const editingId = isEdit && resource.idField
    ? String((initial as Record<string, unknown>)[resource.idField] ?? "")
    : null;

  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(resource.schema),
    defaultValues: initial ?? resource.defaultValues(),
    mode: "onBlur",
  });

  React.useEffect(() => {
    if (open) {
      form.reset(initial ?? resource.defaultValues());
    }
  }, [open, initial, resource, form]);

  const save = useSaveConfigResource(resource.endpoint);

  const onSubmit = form.handleSubmit(async (values) => {
    const payload = values as Record<string, unknown>;
    const promise = save.mutateAsync({ payload, id: editingId ?? null });
    toast.promise(promise, {
      loading: isEdit ? "Saving…" : "Creating…",
      success: isEdit ? "Saved" : "Created",
      error: (err) => (err instanceof Error ? err.message : "Failed to save"),
    });
    try {
      await promise;
      onOpenChange(false);
    } catch {
      // toast already showed error
    }
  });

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={`${isEdit ? "Edit" : "Add"} ${resource.label.toLowerCase().replace(/s$/, "")}`}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={save.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSubmit}
            disabled={save.isPending}
          >
            {save.isPending ? "Saving…" : isEdit ? "Save changes" : "Create"}
          </Button>
        </div>
      }
    >
      <FormProvider {...form}>
        <form onSubmit={onSubmit} className="space-y-4">
          {resource.fields.map((field) => (
            <ConfigFieldRow key={field.name} field={field} />
          ))}
        </form>
      </FormProvider>
    </DetailSheet>
  );
}

function ConfigFieldRow({ field }: { field: ConfigField }) {
  const form = useFormContext();
  const error = getError(form.formState.errors, field.name);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={field.name} className={cn(error && "text-[var(--color-danger)]")}>
          {field.label}
        </Label>
      </div>
      <FieldControl field={field} />
      {"description" in field && field.description && (
        <p className="text-[12px] text-[var(--color-fg-subtle)]">{field.description}</p>
      )}
      {error && (
        <p className="text-[12px] font-medium text-[var(--color-danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

function FieldControl({ field }: { field: ConfigField }) {
  const form = useFormContext();

  if (field.kind === "boolean") {
    return (
      <Controller
        control={form.control}
        name={field.name}
        render={({ field: rhf }) => (
          <Switch
            id={field.name}
            checked={Boolean(rhf.value)}
            onCheckedChange={rhf.onChange}
          />
        )}
      />
    );
  }

  if (field.kind === "select") {
    return (
      <Controller
        control={form.control}
        name={field.name}
        render={({ field: rhf }) => (
          <Select value={String(rhf.value ?? "")} onValueChange={rhf.onChange}>
            <SelectTrigger id={field.name} className="h-9">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    );
  }

  if (field.kind === "symbol") {
    return (
      <Controller
        control={form.control}
        name={field.name}
        render={({ field: rhf }) => (
          <BinanceSymbolCombobox
            value={(rhf.value as string) ?? null}
            onChange={(next, base, dest) => {
              rhf.onChange(next ?? "");
              if (base) form.setValue("baseAsset", base, { shouldValidate: true });
              if (dest)
                form.setValue("destinationAsset", dest, { shouldValidate: true });
            }}
            placeholder={field.placeholder}
          />
        )}
      />
    );
  }

  if (field.kind === "asset-display") {
    const value = form.watch(field.name);
    const asset = typeof value === "string" ? value.trim() : "";
    return (
      <div
        id={field.name}
        className="flex h-9 items-center rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-[13px]"
        aria-readonly="true"
      >
        {asset ? (
          <AssetLabel asset={asset} size={18} />
        ) : (
          <span className="text-[var(--color-fg-subtle)]">
            {field.placeholder ?? "Auto-filled from pair"}
          </span>
        )}
      </div>
    );
  }

  if (field.kind === "textarea") {
    return (
      <Controller
        control={form.control}
        name={field.name}
        render={({ field: rhf }) => (
          <Textarea
            id={field.name}
            placeholder={field.placeholder}
            rows={field.rows ?? 3}
            value={(rhf.value as string) ?? ""}
            onChange={rhf.onChange}
          />
        )}
      />
    );
  }

  if (field.kind === "number") {
    return (
      <Controller
        control={form.control}
        name={field.name}
        render={({ field: rhf }) => (
          <Input
            id={field.name}
            type="number"
            placeholder={field.placeholder}
            value={
              rhf.value === null || rhf.value === undefined
                ? ""
                : String(rhf.value)
            }
            onChange={(event) => {
              const value = event.target.value;
              rhf.onChange(value === "" ? "" : Number(value));
            }}
          />
        )}
      />
    );
  }

  if (field.kind === "json") {
    return <JsonField name={field.name} placeholder={field.placeholder} />;
  }

  if (field.kind === "promotion-thresholds") {
    return <PromotionThresholdsField name={field.name} />;
  }

  return (
    <Controller
      control={form.control}
      name={field.name}
      render={({ field: rhf }) => (
        <Input
          id={field.name}
          placeholder={field.placeholder}
          value={(rhf.value as string) ?? ""}
          onChange={rhf.onChange}
        />
      )}
    />
  );
}

function JsonField({
  name,
  placeholder,
}: {
  name: string;
  placeholder?: string;
}) {
  const form = useFormContext();
  const value = form.watch(name);
  const [text, setText] = React.useState(() =>
    JSON.stringify(value ?? {}, null, 2),
  );
  const [parseError, setParseError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setText(JSON.stringify(value ?? {}, null, 2));
  }, [value]);

  const handleChange = (next: string) => {
    setText(next);
    try {
      const parsed = next.trim() ? JSON.parse(next) : {};
      form.setValue(name, parsed, { shouldDirty: true, shouldValidate: true });
      setParseError(null);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Invalid JSON");
    }
  };

  return (
    <div className="space-y-1.5">
      <Textarea
        id={name}
        placeholder={placeholder}
        rows={8}
        value={text}
        onChange={(event) => handleChange(event.target.value)}
        className="font-mono text-[12px]"
      />
      {parseError && (
        <p className="text-[12px] font-medium text-[var(--color-danger)]">
          {parseError}
        </p>
      )}
    </div>
  );
}

const THRESHOLDS: {
  key: "minTradeCount" | "minTradesPer1000Candles" | "maxDrawdownPercent" | "maxReversalRatio";
  label: string;
  hint: string;
  step?: string;
}[] = [
  {
    key: "minTradeCount",
    label: "Min trade count",
    hint: "Minimum trades a backtest must produce.",
    step: "1",
  },
  {
    key: "minTradesPer1000Candles",
    label: "Min trades / 1k candles",
    hint: "Density: trades per 1000 replayed candles.",
    step: "0.1",
  },
  {
    key: "maxDrawdownPercent",
    label: "Max drawdown %",
    hint: "Largest peak-to-trough drop allowed (lower is stricter).",
    step: "0.1",
  },
  {
    key: "maxReversalRatio",
    label: "Max reversal ratio",
    hint: "Allowed proportion of trades closing on reversal.",
    step: "0.01",
  },
];

function PromotionThresholdsField({ name }: { name: string }) {
  const form = useFormContext();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {THRESHOLDS.map((threshold) => {
        const fullName = `${name}.${threshold.key}`;
        return (
          <div
            key={threshold.key}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3"
          >
            <Label
              htmlFor={fullName}
              className="text-[11px] uppercase tracking-wide text-[var(--color-fg-subtle)]"
            >
              {threshold.label}
            </Label>
            <Controller
              control={form.control}
              name={fullName}
              render={({ field: rhf }) => (
                <Input
                  id={fullName}
                  type="number"
                  step={threshold.step}
                  className="mt-1.5 h-8 text-[13px]"
                  value={
                    rhf.value === null || rhf.value === undefined
                      ? ""
                      : String(rhf.value)
                  }
                  onChange={(event) => {
                    const value = event.target.value;
                    rhf.onChange(value === "" ? undefined : Number(value));
                  }}
                />
              )}
            />
            <p className="mt-1.5 text-[11px] text-[var(--color-fg-subtle)]">
              {threshold.hint}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function getError(
  errors: Record<string, unknown>,
  path: string,
): string | undefined {
  const parts = path.split(".");
  let cursor: unknown = errors;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  if (cursor && typeof cursor === "object" && "message" in cursor) {
    const msg = (cursor as { message?: unknown }).message;
    return typeof msg === "string" ? msg : undefined;
  }
  return undefined;
}
