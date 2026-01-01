import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../../src/trpc/router";
import { expect, test } from "./fixtures";
import { mockGuilds } from "./mockData";

const createClient = () =>
  createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({
        url: "http://127.0.0.1:3001/trpc",
      }),
    ],
  });

test("server config saves overrides to the mock repository", async ({
  page,
  nav,
  serverSelectPage,
  settingsPage,
}) => {
  await serverSelectPage.goto();
  await serverSelectPage.openServerByName(mockGuilds.ddm.name);
  await nav.goToSettings();
  await settingsPage.waitForLoaded();

  const experimentalGroup = page
    .getByTestId("settings-page")
    .getByRole("button", { name: "Experimental" })
    .first();
  if (await experimentalGroup.count()) {
    const expanded = await experimentalGroup.getAttribute("aria-expanded");
    if (expanded !== "true") {
      await experimentalGroup.click();
    }
  }

  const experimentalEntry = page.getByTestId(
    "settings-config-entry-features.experimental",
  );
  await experimentalEntry.scrollIntoViewIfNeeded();
  await experimentalEntry.getByText("On", { exact: true }).click();

  const askMembersEntry = page.getByTestId(
    "settings-config-entry-ask.members.enabled",
  );
  await askMembersEntry.scrollIntoViewIfNeeded();
  await askMembersEntry.getByText("Off", { exact: true }).click();

  const askSharingEntry = page.getByTestId(
    "settings-config-entry-ask.sharing.policy",
  );
  await askSharingEntry.scrollIntoViewIfNeeded();
  await askSharingEntry.getByText("Public", { exact: true }).click();
  await askSharingEntry.getByText("Server", { exact: true }).click();

  const tagsEntry = page.getByTestId("settings-config-entry-notes.tags");
  await tagsEntry.scrollIntoViewIfNeeded();
  const tagsInput = tagsEntry.getByLabel("notes.tags");
  await tagsInput.fill("campaign, weekly");
  await tagsInput.blur();

  await settingsPage.saveConfigButton().click();

  const client = createClient();
  await expect
    .poll(async () => {
      const data = await client.config.server.query({
        serverId: mockGuilds.ddm.id,
      });
      const overrides = new Map(
        data.overrides.map((override) => [override.configKey, override.value]),
      );
      return overrides.get("notes.tags");
    })
    .toBe("campaign, weekly");

  const data = await client.config.server.query({
    serverId: mockGuilds.ddm.id,
  });
  const overrides = new Map(
    data.overrides.map((override) => [override.configKey, override.value]),
  );
  expect(overrides.get("features.experimental")).toBe(true);
  expect(overrides.get("ask.members.enabled")).toBe(false);
  expect(overrides.get("ask.sharing.policy")).toBe("server");
});
