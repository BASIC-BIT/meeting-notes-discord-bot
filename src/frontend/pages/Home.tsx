import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Divider,
  Group,
  List,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  useComputedColorScheme,
} from "@mantine/core";
import {
  IconBolt,
  IconDownload,
  IconFileText,
  IconMicrophone,
  IconQuote,
  IconSearch,
  IconSparkles,
  IconTags,
  IconTimeline,
  IconWaveSine,
} from "@tabler/icons-react";
import FeatureCard from "../components/FeatureCard";
import PricingCard from "../components/PricingCard";
import Section from "../components/Section";
import Surface from "../components/Surface";
import EvidenceCard from "../components/EvidenceCard";
import {
  heroBackground,
  uiBorders,
  uiColors,
  uiEffects,
  uiTypography,
} from "../uiTokens";
import { trpc } from "../services/trpc";
import type { BillingInterval } from "../../types/pricing";
import {
  annualSavingsLabel,
  billingLabelForInterval,
  buildPaidPlanLookup,
  formatPlanPrice,
  resolvePaidPlan,
} from "../utils/pricing";

const features = [
  {
    title: "Automatic capture",
    description:
      "Join on demand or auto-record a channel. Chronote captures audio, chat, and attendance.",
    icon: <IconMicrophone size={22} />,
  },
  {
    title: "Transcript + summary",
    description:
      "Structured notes with decisions and action items are posted back to Discord.",
    icon: <IconFileText size={22} />,
  },
  {
    title: "Search with receipts",
    description:
      "Ask questions across recent sessions and get answers with quotes and timestamps.",
    icon: <IconSearch size={22} />,
  },
  {
    title: "Tags and filters",
    description:
      "Add lightweight tags so meetings stay grouped by project, team, or campaign.",
    icon: <IconTags size={22} />,
  },
  {
    title: "Live voice mode",
    description:
      "A live mode where Chronote can speak back in voice for quick confirmations.",
    icon: <IconWaveSine size={22} />,
  },
  {
    title: "Exports + retention",
    description: "Download audio, transcript, and notes from the web library.",
    icon: <IconDownload size={22} />,
  },
  {
    title: "Built for speed",
    description: "Fast onboarding, minimal setup, and sensible defaults.",
    icon: <IconBolt size={22} />,
  },
];

const howItWorks = [
  {
    step: "01",
    title: "Start recording",
    description: "Use a command or enable auto-recording for a voice channel.",
  },
  {
    step: "02",
    title: "Notes land in Discord",
    description: "Transcript + structured summary post to your chosen channel.",
  },
  {
    step: "03",
    title: "Search it later",
    description: "Ask questions across recent meetings, with receipts.",
  },
];

const useCases = [
  {
    title: "Communities",
    description:
      "Keep volunteer staff aligned across weekly syncs, moderation meetings, and event planning.",
    bullets: ["Catch-up summaries", "Attendance + decisions", "Action items"],
  },
  {
    title: "Tabletop campaigns",
    description:
      "Recall lore, NPC names, and plot threads without digging through audio.",
    bullets: ["Session recaps", "Character tracking", "Campaign memory"],
  },
  {
    title: "Product teams",
    description:
      "Capture decisions, tasks, and questions across standups, planning, and retros.",
    bullets: ["Action items", "Decision logs", "Cross-team context"],
  },
];

export default function Home() {
  const scheme = useComputedColorScheme("dark");
  const isDark = scheme === "dark";
  const [interval, setInterval] = useState<BillingInterval>("month");
  const pricingQuery = trpc.pricing.plans.useQuery(undefined, {
    staleTime: 1000 * 60 * 5,
  });
  const paidPlans = pricingQuery.data?.plans ?? [];
  const planLookup = useMemo(() => buildPaidPlanLookup(paidPlans), [paidPlans]);
  const hasAnnualPlans = paidPlans.some((plan) => plan.interval === "year");
  const basicPlan = resolvePaidPlan(planLookup, "basic", interval);
  const proPlan = resolvePaidPlan(planLookup, "pro", interval);

  const heroBackgroundImage = heroBackground(isDark);

  return (
    <Stack gap="xl">
      <Surface
        tone="raised"
        p={{ base: "lg", md: "xl" }}
        style={{ backgroundImage: heroBackgroundImage }}
        data-testid="home-hero"
      >
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
          <Stack gap="md">
            <Text
              size="xs"
              c={isDark ? "cyan.3" : "cyan.7"}
              style={uiTypography.heroKicker}
            >
              Discord voice logbook
            </Text>
            <Title order={1} fw={750}>
              Transcripts and summaries for Discord voice.
            </Title>
            <Text size="lg" c="dimmed">
              Chronote records the session, posts structured notes back to your
              server, and builds a searchable logbook on the web.
            </Text>
            <Group gap="sm">
              <Button
                size="md"
                variant="gradient"
                gradient={{ from: "brand", to: "violet" }}
                component="a"
                data-testid="home-cta-discord"
                href="https://discord.com/oauth2/authorize?client_id=1278729036528619633&scope=bot%20applications.commands"
              >
                Add to Discord
              </Button>
              <Button
                size="md"
                variant="outline"
                component="a"
                data-testid="home-cta-docs"
                href="https://meetingnotes.basicbit.net"
              >
                View Docs
              </Button>
            </Group>
            <Group gap="lg" wrap="wrap">
              <Group gap={8} wrap="nowrap">
                <ThemeIcon variant="light" color="cyan" size={26}>
                  <IconMicrophone size={14} />
                </ThemeIcon>
                <Stack gap={0}>
                  <Text size="sm" fw={600}>
                    Auto-recording
                  </Text>
                  <Text size="xs" c="dimmed">
                    Set it once, keep it running
                  </Text>
                </Stack>
              </Group>
              <Group gap={8} wrap="nowrap">
                <ThemeIcon variant="light" color="cyan" size={26}>
                  <IconQuote size={14} />
                </ThemeIcon>
                <Stack gap={0}>
                  <Text size="sm" fw={600}>
                    Receipts
                  </Text>
                  <Text size="xs" c="dimmed">
                    Know who said what
                  </Text>
                </Stack>
              </Group>
              <Group gap={8} wrap="nowrap">
                <ThemeIcon variant="light" color="cyan" size={26}>
                  <IconTimeline size={14} />
                </ThemeIcon>
                <Stack gap={0}>
                  <Text size="sm" fw={600}>
                    Server library
                  </Text>
                  <Text size="xs" c="dimmed">
                    Browse sessions on the web
                  </Text>
                </Stack>
              </Group>
            </Group>
          </Stack>
          <Stack gap="md">
            <Surface p="md">
              <Stack gap="sm">
                <Group gap="sm">
                  <ThemeIcon color="cyan" variant="light">
                    <IconTimeline size={18} />
                  </ThemeIcon>
                  <Text fw={600}>Notes in Discord</Text>
                </Group>
                <Surface
                  p="md"
                  tone="soft"
                  style={{
                    boxShadow: uiEffects.accentInset,
                  }}
                >
                  <Stack gap={6}>
                    <Text size="xs" c="dimmed">
                      #session-notes
                    </Text>
                    <Text fw={600}>D&D session - recap</Text>
                    <List spacing="xs" size="sm">
                      <List.Item>
                        Decision: take the mountain pass instead of the swamp
                      </List.Item>
                      <List.Item>
                        Action: Rin posts the map + loot sheet in #campaign-info
                      </List.Item>
                      <List.Item>Next time: Sunday 7pm (voice)</List.Item>
                      <List.Item>Highlights + attendance included</List.Item>
                    </List>
                  </Stack>
                </Surface>
              </Stack>
            </Surface>
            <Surface p="md">
              <Stack gap="xs">
                <Group gap="sm">
                  <ThemeIcon color="brand" variant="light">
                    <IconSparkles size={18} />
                  </ThemeIcon>
                  <Text fw={600}>Quote + context</Text>
                </Group>
                <Text size="sm" c="dimmed">
                  Receipts tie back to the exact moment in the conversation.
                </Text>
                <Group gap="xs" wrap="wrap">
                  <Text size="xs" c="dimmed" fw={600}>
                    Tags:
                  </Text>
                  {["campaign", "heist", "npc"].map((tag) => (
                    <Badge key={tag} variant="light" color="gray">
                      {tag}
                    </Badge>
                  ))}
                </Group>
                <EvidenceCard
                  quote="If we hit the vault before midnight, the ward doesn't reset."
                  speaker="Rin"
                  time="01:12:44"
                  channel="#tabletop-voice"
                />
              </Stack>
            </Surface>
          </Stack>
        </SimpleGrid>
      </Surface>

      <Section
        eyebrow="Built for"
        title="Work and play alike"
        description="Designed for teams, communities, and campaigns that need memory."
      >
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
          {useCases.map((useCase) => (
            <Surface key={useCase.title} p="lg">
              <Stack gap="xs">
                <Title order={4}>{useCase.title}</Title>
                <Text c="dimmed">{useCase.description}</Text>
                <Divider />
                <List spacing="xs" size="sm">
                  {useCase.bullets.map((bullet) => (
                    <List.Item key={bullet}>{bullet}</List.Item>
                  ))}
                </List>
              </Stack>
            </Surface>
          ))}
        </SimpleGrid>
      </Section>

      <Section
        eyebrow="Features"
        title="Everything you need to remember the meeting"
        description="Capture, compress, and recall your meetings without leaving Discord."
      >
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="lg">
          {features.map((feature) => (
            <FeatureCard
              key={feature.title}
              title={feature.title}
              description={feature.description}
              icon={feature.icon}
            />
          ))}
        </SimpleGrid>
      </Section>

      <Section
        eyebrow="Workflow"
        title="From voice channel to logbook in minutes"
        description="A quiet pipeline from live voice to a usable record."
      >
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
          {howItWorks.map((step) => (
            <Surface key={step.step} p="lg" tone="soft">
              <Stack gap="xs">
                <Text size="xs" c="cyan.3" style={uiTypography.stepKicker}>
                  {step.step}
                </Text>
                <Title order={4}>{step.title}</Title>
                <Text c="dimmed">{step.description}</Text>
              </Stack>
            </Surface>
          ))}
        </SimpleGrid>
      </Section>

      <Section
        eyebrow="Evidence-first"
        title="Answers come with receipts"
        description="Chronote does not guess. Every answer is grounded in quotes, speakers, and timestamps."
      >
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
          <Surface p="lg" tone="soft">
            <Stack gap="sm">
              <Group gap="sm">
                <ThemeIcon variant="light" color="cyan">
                  <IconSearch size={18} />
                </ThemeIcon>
                <Text fw={600}>Search across sessions</Text>
              </Group>
              <Text c="dimmed">
                Ask about decisions, blockers, or campaign lore. Results point
                back to the exact moment it was said.
              </Text>
              <EvidenceCard
                quote="The outage root cause was the cache eviction policy."
                speaker="Sam"
                meeting="Weekly ops sync"
              />
            </Stack>
          </Surface>
          <Surface p="lg" tone="soft">
            <Stack gap="sm">
              <Group gap="sm">
                <ThemeIcon variant="light" color="brand">
                  <IconSparkles size={18} />
                </ThemeIcon>
                <Text fw={600}>Structured summaries</Text>
              </Group>
              <Text c="dimmed">
                Notes are organized as decisions, action items, and highlights
                so teams can scan quickly.
              </Text>
              <List spacing="xs" size="sm">
                <List.Item>Decision log with owners</List.Item>
                <List.Item>Action items ready to copy</List.Item>
                <List.Item>Speaker timeline with timestamps</List.Item>
              </List>
            </Stack>
          </Surface>
        </SimpleGrid>
      </Section>

      <Section
        eyebrow="Pricing"
        title="Memory power, server-based pricing"
        description="Start free, upgrade when you need deeper recall and longer retention."
      >
        <Group justify="space-between" align="center" wrap="wrap">
          <Text size="sm" c="dimmed">
            Pricing shown per server.
          </Text>
          <SegmentedControl
            value={interval}
            onChange={(value) => setInterval(value as BillingInterval)}
            data={[
              { label: "Monthly", value: "month" },
              {
                label: "Annual (best value)",
                value: "year",
                disabled: !hasAnnualPlans,
              },
            ]}
            size="sm"
          />
        </Group>
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
          <PricingCard
            name="Free"
            price="$0"
            description="Great for lightweight teams and one-off sessions."
            badge="Free forever"
            features={[
              "Up to 4 hours per week",
              "Up to 90 minutes per meeting",
              "Ask across recent meetings",
              "Notes, tags, and summary embeds",
            ]}
            cta="Get started"
            billingLabel="Always free"
          />
          <PricingCard
            name="Basic"
            price={formatPlanPrice(basicPlan, interval)}
            description="Unlock longer sessions and deeper recall."
            features={[
              "Up to 20 hours per week",
              "Up to 2 hours per meeting (8 hours coming soon)",
              "Ask across longer history",
              "Live voice mode",
            ]}
            cta="Upgrade to Basic"
            highlighted
            billingLabel={`${billingLabelForInterval(interval)}${
              interval === "year" ? ` • ${annualSavingsLabel}` : ""
            }`}
          />
          <PricingCard
            name="Pro"
            price={formatPlanPrice(proPlan, interval)}
            description="Unlimited retention and deep server memory."
            features={[
              "Unlimited retention",
              "Unlimited recording time",
              "Ask across full retention",
              "Up to 2 hours per meeting (8 hours coming soon)",
              "Priority features + support",
            ]}
            cta="Upgrade to Pro"
            ctaDisabled
            badge="Unlimited meetings"
            tone="raised"
            borderColor={uiColors.accentBorder}
            borderWidth={uiBorders.accentWidth}
            billingLabel={`${billingLabelForInterval(interval)}${
              interval === "year" ? ` • ${annualSavingsLabel}` : ""
            }`}
          />
        </SimpleGrid>
      </Section>

      <Surface p={{ base: "lg", md: "xl" }}>
        <Group justify="space-between" align="center" wrap="wrap">
          <Stack gap={6}>
            <Title order={3}>Ready to keep the record?</Title>
            <Text c="dimmed">
              Add Chronote, run your first meeting, and get notes in minutes.
            </Text>
          </Stack>
          <Button
            size="md"
            variant="gradient"
            gradient={{ from: "brand", to: "violet" }}
            component="a"
            href="https://discord.com/oauth2/authorize?client_id=1278729036528619633&scope=bot%20applications.commands"
          >
            Add to Discord
          </Button>
        </Group>
      </Surface>
    </Stack>
  );
}
