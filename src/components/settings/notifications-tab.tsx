"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Panel,
  PanelBody,
  PanelHeader,
  Field,
  FieldHint,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  useToast,
} from "@/components/ui";
import { updateNotificationPrefs } from "@/lib/actions/notifications";
import type { NotificationPrefsView } from "@/lib/queries/notifications";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * Every control saves on change — there is nothing to "Save" here, and a
 * switch that looks on but isn't until a button is pressed is the classic
 * settings-page lie. The whole row is sent each time (see the action).
 */
export function NotificationsTab({
  initial,
  email,
  timezone,
  emailAvailable,
}: {
  initial: NotificationPrefsView;
  email: string;
  timezone: string;
  emailAvailable: boolean;
}) {
  const t = useTranslations("settings.notifications");
  const { toast } = useToast();
  const [prefs, setPrefs] = React.useState(initial);
  const [pending, startTransition] = React.useTransition();

  function save(patch: Partial<NotificationPrefsView>) {
    const previous = prefs;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    startTransition(async () => {
      const result = await updateNotificationPrefs(next);
      if (result.ok) {
        toast({ title: t("saved") });
      } else {
        setPrefs(previous);
        toast({
          title: t("couldNotSave"),
          description: result.formError ?? Object.values(result.fieldErrors ?? {})[0]?.[0],
          tone: "loss",
        });
      }
    });
  }

  const emailDisabled = !emailAvailable || pending;
  const disabledReason = emailAvailable ? undefined : t("emailOff");

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader title={t("emailTitle")} caption={t("emailCaption", { email })} />
        <PanelBody className="flex max-w-md flex-col gap-4">
          {!emailAvailable ? <p className="text-xs text-ink-3">{t("emailOff")}</p> : null}
          <ToggleRow
            label={t("journalReminder")}
            hint={t("journalReminderHint")}
            checked={prefs.journalReminder}
            disabled={emailDisabled}
            title={disabledReason}
            onChange={(v) => save({ journalReminder: v })}
          />
          <ToggleRow
            label={t("weeklySummary")}
            hint={t("weeklySummaryHint")}
            checked={prefs.weeklySummary}
            disabled={emailDisabled}
            title={disabledReason}
            onChange={(v) => save({ weeklySummary: v })}
          />
          <Field>
            <FieldLabel>{t("sendHour")}</FieldLabel>
            <Select
              value={String(prefs.sendHour)}
              onValueChange={(v) => save({ sendHour: Number(v) })}
              disabled={emailDisabled}
            >
              <SelectTrigger className="w-32" title={disabledReason}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOURS.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {`${String(h).padStart(2, "0")}:00`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldHint>{t("sendHourHint", { timezone })}</FieldHint>
          </Field>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title={t("inAppTitle")} />
        <PanelBody className="max-w-md">
          <ToggleRow
            label={t("inAppReminder")}
            hint={t("inAppReminderHint")}
            checked={prefs.inAppReminder}
            disabled={pending}
            onChange={(v) => save({ inAppReminder: v })}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  title,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  title?: string;
  onChange: (value: boolean) => void;
}) {
  const id = React.useId();
  return (
    <div className="flex items-start justify-between gap-4" title={title}>
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-sm text-ink">
          {label}
        </label>
        <p id={`${id}-hint`} className="text-xs text-ink-3">
          {hint}
        </p>
      </div>
      <Switch
        id={id}
        aria-describedby={`${id}-hint`}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        className="mt-0.5"
      />
    </div>
  );
}
