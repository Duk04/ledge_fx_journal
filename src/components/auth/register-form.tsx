"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { registerUser } from "@/lib/actions/auth";

type FieldName = "name" | "email" | "password" | "confirm";
type State = { formError?: string; fieldErrors?: Partial<Record<FieldName, string[]>> } | null;

/**
 * The sign-up form. A client component, unlike the sign-in form, because a
 * registration fails on a FIELD ("that email is taken", "too short", "the
 * two passwords differ") and the message belongs under that field. Bounced
 * through a query string, as the old combined login page did, it arrived as
 * a bare "Fix the errors below." with nothing below.
 *
 * Name and email are controlled: React 19 resets a form action's
 * uncontrolled inputs once the action settles, which would wipe them after
 * every error. The passwords are left to reset — retyping those is normal.
 * On success the action redirects, so a result only ever means failure.
 */
export function RegisterForm({ minPasswordChars }: { minPasswordChars: number }) {
  const t = useTranslations("auth");
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [state, action, pending] = React.useActionState<State, FormData>(async (_prev, formData) => {
    const result = await registerUser(formData);
    return result && !result.ok ? { formError: result.formError, fieldErrors: result.fieldErrors } : null;
  }, null);

  const err = (field: FieldName) => state?.fieldErrors?.[field]?.[0];
  const input = "bg-panel border border-line rounded-control h-control px-2.5 text-sm w-full";

  return (
    <form action={action} className="space-y-3" noValidate={false}>
      {state?.formError ? (
        <div role="alert" className="rounded-control border border-loss/35 bg-loss-weak px-3 py-2 text-sm text-loss">
          {state.formError}
        </div>
      ) : null}

      <Row id="reg-name" label={t("name")} error={err("name")}>
        <input
          id="reg-name"
          name="name"
          type="text"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!err("name") || undefined}
          aria-describedby={err("name") ? "reg-name-error" : undefined}
          className={input}
        />
      </Row>
      <Row id="reg-email" label={t("email")} error={err("email")}>
        <input
          id="reg-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={!!err("email") || undefined}
          aria-describedby={err("email") ? "reg-email-error" : undefined}
          className={input}
        />
      </Row>
      <Row
        id="reg-password"
        label={t("password")}
        error={err("password")}
        hint={t("passwordHint", { min: String(minPasswordChars) })}
      >
        <input
          id="reg-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={minPasswordChars}
          required
          aria-invalid={!!err("password") || undefined}
          aria-describedby={err("password") ? "reg-password-error" : "reg-password-hint"}
          className={input}
        />
      </Row>
      <Row id="reg-confirm" label={t("confirmYourPassword")} error={err("confirm")}>
        <input
          id="reg-confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={minPasswordChars}
          required
          aria-invalid={!!err("confirm") || undefined}
          aria-describedby={err("confirm") ? "reg-confirm-error" : undefined}
          className={input}
        />
      </Row>

      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {t("createAccount")}
      </Button>
    </form>
  );
}

function Row({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm text-ink-2">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-loss">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
