import { Page } from "@/components/shell/page";
import { SectionHead, Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { getProfile, listTagsGrouped, listInstruments } from "@/lib/queries/settings";
import { ProfileTab } from "@/components/settings/profile-tab";
import { TagsTab } from "@/components/settings/tags-tab";
import { InstrumentsTab } from "@/components/settings/instruments-tab";
import { DataTab } from "@/components/settings/data-tab";

export default async function SettingsPage() {
  const user = await requireUser();
  const [profile, tags, instruments] = await Promise.all([
    getProfile(user.id),
    listTagsGrouped(user.id),
    listInstruments(),
  ]);

  return (
    <Page width="reading">
      <SectionHead title="Settings" hint="Profile, tags, instrument contracts, and your data." />
      <Tabs defaultValue="profile">
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
          <InstrumentsTab initialInstruments={instruments} />
        </TabsContent>
        <TabsContent value="data" className="pt-4">
          <DataTab />
        </TabsContent>
      </Tabs>
    </Page>
  );
}
