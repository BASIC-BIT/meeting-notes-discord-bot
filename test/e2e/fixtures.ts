import { test as base, expect } from "@playwright/test";
import {
  AskPage,
  BillingPage,
  HomePage,
  LibraryPage,
  PortalNav,
  ServerSelectPage,
  SettingsPage,
} from "./pages";

type Fixtures = {
  homePage: HomePage;
  serverSelectPage: ServerSelectPage;
  nav: PortalNav;
  libraryPage: LibraryPage;
  askPage: AskPage;
  billingPage: BillingPage;
  settingsPage: SettingsPage;
};

export const test = base.extend<Fixtures>({
  homePage: async ({ page }, use) => {
    await use(new HomePage(page));
  },
  serverSelectPage: async ({ page }, use) => {
    await use(new ServerSelectPage(page));
  },
  nav: async ({ page }, use) => {
    await use(new PortalNav(page));
  },
  libraryPage: async ({ page }, use) => {
    await use(new LibraryPage(page));
  },
  askPage: async ({ page }, use) => {
    await use(new AskPage(page));
  },
  billingPage: async ({ page }, use) => {
    await use(new BillingPage(page));
  },
  settingsPage: async ({ page }, use) => {
    await use(new SettingsPage(page));
  },
});

export { expect };
