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
  useToast,
} from "@/components/ui";
import { updateProfile } from "@/app/(app)/settings/actions";
import { IANA_TIMEZONES } from "./timezones";
import type { ProfileView } from "@/lib/queries/settings";

type FormValues = { name: string; timezone: string };

export function ProfileTab({ profile }: { profile: ProfileView }) {
  const { toast } = useToast();
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
      toast({ title: "Profile updated." });
      reset(values);
    } else {
      toast({
        title: "Could not save",
        description: result.formError ?? "Check the fields and try again.",
        tone: "loss",
      });
    }
  }

  return (
    <Panel>
      <PanelBody>
        <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-md flex-col gap-4">
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input {...register("name")} placeholder="Your name" />
          </Field>

          <Field>
            <FieldLabel>Email</FieldLabel>
            <Input value={profile.email} disabled readOnly />
            <FieldHint>Email is set at sign-in and can&apos;t be changed here.</FieldHint>
          </Field>

          <Field>
            <FieldLabel>Timezone</FieldLabel>
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
            <FieldHint>
              Timezone decides which calendar day a trade lands on in the journal calendar and in daily P&amp;L charts.
              It does not change market-session tagging (London / New York / …), which is always based on UTC, and it
              never changes any stored timestamp.
            </FieldHint>
          </Field>

          <Button type="submit" variant="primary" className="self-start" disabled={isSubmitting || !isDirty}>
            Save changes
          </Button>
        </form>
      </PanelBody>
    </Panel>
  );
}
