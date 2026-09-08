"use client";

import { Field, FieldLabel, Input, NumberInput, Switch } from "@/components/ui";

export type ParamValue = number | string | boolean;
export type ParamRecord = Record<string, ParamValue>;

/**
 * Renders one control per declared parameter, typed off the DEFAULT value's
 * own JS type — a strategy that declares `{ lots: 1 }` gets a number field,
 * `{ pessimistic: true }` gets a switch, and anything else gets a text
 * field. There is no separate "parameter schema": a strategy's `params`
 * object (see StrategyModule/ExampleStrategy) IS the schema, which is why
 * loading a new template or a different saved strategy fully replaces the
 * set of fields shown rather than merging with whatever was there before.
 */
export function ParamsEditor({ params, onChange }: { params: ParamRecord; onChange: (next: ParamRecord) => void }) {
  const keys = Object.keys(params);
  if (keys.length === 0) {
    return <p className="text-xs text-ink-3">This strategy declares no parameters.</p>;
  }

  function set(key: string, value: ParamValue) {
    onChange({ ...params, [key]: value });
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {keys.map((key) => {
        const value = params[key];
        return (
          <Field key={key}>
            <FieldLabel>{key}</FieldLabel>
            {typeof value === "boolean" ? (
              <div className="flex h-control items-center">
                <Switch checked={value} onCheckedChange={(v) => set(key, v)} />
              </div>
            ) : typeof value === "number" ? (
              <NumberInput
                value={String(value)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  set(key, Number.isFinite(n) ? n : 0);
                }}
              />
            ) : (
              <Input value={String(value)} onChange={(e) => set(key, e.target.value)} />
            )}
          </Field>
        );
      })}
    </div>
  );
}
