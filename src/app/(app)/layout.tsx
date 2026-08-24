import { AppShell } from "@/components/shell/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { requireUser } from "@/lib/session";
import { resolveActiveAccountId } from "@/lib/active-account";
import { listAccounts } from "@/lib/queries/accounts";
import { RegisterServiceWorker } from "@/components/pwa/register-sw";
import { OfflineBanner } from "@/components/pwa/offline-banner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [accounts, activeAccountId] = await Promise.all([
    listAccounts(user.id),
    resolveActiveAccountId(user.id),
  ]);

  return (
    <TooltipProvider>
      <RegisterServiceWorker />
      <OfflineBanner />
      <AppShell
        user={{ name: user.name, email: user.email, timezone: user.timezone }}
        activeAccountId={activeAccountId}
        accounts={accounts
          .filter((a) => !a.isArchived)
          .map((a) => ({
            id: a.id,
            label: a.label,
            accountType: a.accountType,
            currency: a.currency,
            equity: a.equity,
            netPnl: a.netPnl,
            spark: a.spark,
          }))}
      >
        {children}
      </AppShell>
    </TooltipProvider>
  );
}
