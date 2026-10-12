"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui";
import { AccountFormDialog } from "./account-form-dialog";

export function NewAccountButton() {
  const t = useTranslations("accounts");
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="primary" size="md" onClick={() => setOpen(true)}>
        <Plus /> {t("newAccount")}
      </Button>
      <AccountFormDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
