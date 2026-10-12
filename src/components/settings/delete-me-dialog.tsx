"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Field,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  Panel,
  PanelBody,
  PanelHeader,
} from "@/components/ui";
import { deleteMyAccount } from "@/lib/actions/account-deletion";

/**
 * The "delete my account" panel and its confirmation. Success never returns
 * here: the action signs out and redirects to /login with a notice, so this
 * only ever renders failures (wrong password, last owner, stale sign-in).
 */
export function DeleteMeSection({ email, hasPassword }: { email: string; hasPassword: boolean }) {
  const t = useTranslations("settings.danger");
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [errors, setErrors] = React.useState<{ form?: string; confirmEmail?: string; password?: string }>({});
  // Controlled on purpose: React 19 resets a `<form action>`'s uncontrolled
  // inputs once the action settles, which after a wrong password would wipe
  // the typed email too. Only the password is cleared on failure.
  const [typedEmail, setTypedEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  function submit(formData: FormData) {
    setErrors({});
    startTransition(async () => {
      const result = await deleteMyAccount(formData);
      if (!result.ok) {
        setPassword("");
        setErrors({
          form: result.formError,
          confirmEmail: result.fieldErrors?.confirmEmail?.[0],
          password: result.fieldErrors?.password?.[0],
        });
      }
    });
  }

  return (
    <Panel>
      <PanelHeader title={t("title")} caption={t("caption")} />
      <PanelBody className="flex flex-col items-start gap-3">
        <p className="text-xs text-ink-3">{t("exportFirst")}</p>
        <Button type="button" variant="danger" onClick={() => setOpen(true)}>
          {t("open")}
        </Button>
      </PanelBody>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setErrors({});
            setTypedEmail("");
            setPassword("");
          }
        }}
      >
        <DialogContent size="sm">
          <DialogHeader title={t("dialogTitle")} description={t("dialogBody")} />
          <form action={submit}>
            <DialogBody className="flex flex-col gap-3">
              {errors.form ? (
                <p
                  role="alert"
                  className="rounded-control border border-loss/35 bg-loss-weak px-2.5 py-2 text-xs text-loss"
                >
                  {errors.form}
                </p>
              ) : null}
              <Field>
                <FieldLabel>{t("confirmEmail")}</FieldLabel>
                <Input
                  name="confirmEmail"
                  autoComplete="off"
                  placeholder={email}
                  value={typedEmail}
                  onChange={(e) => setTypedEmail(e.target.value)}
                  required
                />
                <FieldError>{errors.confirmEmail}</FieldError>
              </Field>
              {hasPassword ? (
                <Field>
                  <FieldLabel>{t("password")}</FieldLabel>
                  <Input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <FieldError>{errors.password}</FieldError>
                </Field>
              ) : (
                <FieldHint>{t("noPassword")}</FieldHint>
              )}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" variant="danger" disabled={pending}>
                {t("confirm")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
