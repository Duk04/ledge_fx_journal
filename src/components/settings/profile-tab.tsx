"use client";

import { useForm, Controller } from "react-hook-form";
import {
  Panel,
  PanelBody,
  Field,
  FieldLabel,
  FieldHint,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Button,
  Segmented,
  SegmentedItem,
  useToast,
} from "@/components/ui";
import { updateProfile } from "@/app/(app)/settings/actions";
import { IANA_TIMEZONES } from "./timezones";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { setLocale } from "@/lib/actions/locale";
import { LOCALES, LOCALE_LABELS } from "@/i18n/config";
import type { ProfileView } from "@/lib/queries/settings";

type FormValues = { name: string; timezone: string };

export function ProfileTab({ profile }: { profile: ProfileView }) {
  const { toast } = useToast();
  const t = useTranslations("settings.profile");
  const router = useRouter();
  const [locale, setLocaleState] = React.useState(profile.locale);
  const [savingLocale, startLocale] = React.useTransition();
  const {
    register,
    control,
    handleSubmit,
    formState: { isSubmitting, isDirty },
    reset,
  } = useForm<FormValues>({ defaultValues: { name: profile.name ?? "", timezone: profile.timezone } });

  async function onSubmit(values: FormValues) {
    const result = await updateProfile(values);
    if (result.ok) {
      toast({ title: t("saved") });
      reset(values);
    } else {
      toast({
        title: t("couldNotSave"),
        description: result.formError ?? t("checkFields"),
        tone: "loss",
      });
    }
  }

  return (
    <Panel>
      <PanelBody>
        <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-md flex-col gap-4">
          <Field>
            <FieldLabel>{t("name")}</FieldLabel>
            <Input {...register("name")} placeholder={t("namePlaceholder")} />
          </Field>

          <Field>
            <FieldLabel>{t("email")}</FieldLabel>
            <Input value={profile.email} disabled readOnly />
            <FieldHint>{t("emailHint")}</FieldHint>
          </Field>

          <Field>
            <FieldLabel>{t("timezone")}</FieldLabel>
            <Controller
              control={control}
              name="timezone"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IANA_TIMEZONES.map((tz) => (
                      <SelectItem key={tz.value} value={tz.value}>
                        {tz.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldHint>{t("timezoneHint")}</FieldHint>
          </Field>

          <Button type="submit" variant="primary" className="self-start" disabled={isSubmitting || !isDirty}>
            {t("save")}
          </Button>
        </form>

        {/* Outside the form on purpose: a language change applies at once,
            with no Save, and re-renders the whole app in the new language. */}
        <div className="mt-6 max-w-md border-t border-line pt-4">
          <Field>
            <FieldLabel>{t("language")}</FieldLabel>
            <Segmented
              value={locale}
              onValueChange={(next) => {
                if (!next || next === locale) return;
                setLocaleState(next);
                startLocale(async () => {
                  await setLocale(next);
                  router.refresh();
                });
              }}
              aria-busy={savingLocale || undefined}
            >
              {LOCALES.map((l) => (
                <SegmentedItem key={l} value={l}>
                  {LOCALE_LABELS[l]}
                </SegmentedItem>
              ))}
            </Segmented>
            <FieldHint>{t("languageHint")}</FieldHint>
          </Field>
        </div>
      </PanelBody>
    </Panel>
  );
}
