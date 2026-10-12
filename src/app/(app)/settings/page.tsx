import { Page } from "@/components/shell/page";
import { SectionHead, UrlTabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui";
import { canWriteSharedData, requireUser } from "@/lib/session";
import { getProfile, listTagsGrouped, listInstruments } from "@/lib/queries/settings";
import { ProfileTab } from "@/components/settings/profile-tab";
import { TagsTab } from "@/components/settings/tags-tab";
import { InstrumentsTab } from "@/components/settings/instruments-tab";
import { DataTab } from "@/components/settings/data-tab";

const TABS = ["profile", "tags", "instruments", "data"] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: tabParam } = await searchParams;
  const tab = TABS.find((t) => t === tabParam) ?? "profile";
  const user = await requireUser();
  // Resolved here rather than in the client component: the role lives in the
  // database (see lib/session.ts on where authority lives), and a client has
  // no business being trusted with it.
  const owner = canWriteSharedData(user.role);
  const [profile, tags, instruments] = await Promise.all([
    getProfile(user.id),
    listTagsGrouped(user.id),
    listInstruments(),
  ]);

  return (
    <Page width="reading">
      <SectionHead title="Settings" hint="Profile, tags, instrument contracts, and your data." />
      <UrlTabs value={tab}>
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
          <TabsTrigger value="instruments">Instruments</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="pt-4">
          <ProfileTab profile={profile} />
        </TabsContent>
        <TabsContent value="tags" className="pt-4">
          <TagsTab initialTags={tags} />
        </TabsContent>
        <TabsContent value="instruments" className="pt-4">
          <InstrumentsTab initialInstruments={instruments} canEdit={owner} />
        </TabsContent>
        <TabsContent value="data" className="pt-4">
          <DataTab />
        </TabsContent>
      </UrlTabs>
    </Page>
  );
}
