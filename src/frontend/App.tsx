import {
  AppShell,
  Container,
  Title,
  Group,
  SegmentedControl,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { useState } from "react";
import Billing from "./pages/Billing";
import { GuildProvider } from "./contexts/GuildContext";
import GuildSelect from "./components/GuildSelect";
import { AuthProvider } from "./contexts/AuthContext";
import Home from "./pages/Home";

function App() {
  const [activePage, setActivePage] = useState<"home" | "billing">("home");
  const handlePageChange = (value: string) => {
    if (value === "home" || value === "billing") {
      setActivePage(value);
    }
  };
  return (
    <AuthProvider>
      <GuildProvider>
        <AppShell
          padding="md"
          header={{ height: 72 }}
          styles={{
            header: {
              borderBottom: "1px solid var(--mantine-color-gray-3)",
              backgroundColor: "var(--mantine-color-gray-0)",
            },
          }}
        >
          <Notifications position="top-right" />
          <AppShell.Header p="md">
            <Container size="lg" h="100%">
              <Group
                h="100%"
                align="center"
                justify="space-between"
                gap="md"
                wrap="nowrap"
              >
                <Group gap="sm" align="center" wrap="nowrap">
                  <Title order={3} miw={180}>
                    Meeting Notes Bot
                  </Title>
                  <SegmentedControl
                    size="sm"
                    value={activePage}
                    onChange={handlePageChange}
                    data={[
                      { label: "Home", value: "home" },
                      { label: "Billing", value: "billing" },
                    ]}
                  />
                </Group>
                <GuildSelect w={260} maw={280} miw={200} />
              </Group>
            </Container>
          </AppShell.Header>
          <AppShell.Main>
            <Container size="lg" py="md">
              {activePage === "home" ? <Home /> : <Billing />}
            </Container>
          </AppShell.Main>
        </AppShell>
      </GuildProvider>
    </AuthProvider>
  );
}

export default App;
