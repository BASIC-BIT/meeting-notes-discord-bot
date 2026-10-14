import {
  Alert,
  Button,
  Divider,
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type { BillingInterval, PaidTier } from "../../types/pricing";
import { formatCurrency } from "../utils/pricing";

export type BillingChangeReviewQuote = {
  serverName: string;
  targetTier: PaidTier | "free";
  interval: BillingInterval;
  effectiveAt: string;
  timing: "immediate" | "renewal";
  currency: string;
  chargeLabel: string;
  chargePeriod: string | null;
  creditLabel: string;
  planCharge: number;
  offerSavings: number;
  unusedCredit: number;
  taxAmount: number;
  taxTreatment: "added" | "included";
  // Positive means an amount owed; negative means available credit applied.
  billingBalance: number;
  amountDue: number;
  remainingCredit: number;
  // Base plan rate before added tax or account credit.
  nextPlanRate: number | null;
  nextAt: string | null;
  offerTerms: string | null;
  endingOffer: "monthly" | "annual" | null;
};
// quote_changed is pre-charge only. Unknown provider outcomes remain processing.
export type BillingChangeReviewStatus =
  | "review"
  | "payment_required"
  | "processing"
  | "quote_changed"
  | "cancellation_unknown";
type Props = {
  quote: BillingChangeReviewQuote;
  status?: BillingChangeReviewStatus;
  onConfirm: () => void;
  onBack: () => void;
  onContinuePayment: () => void;
  onChangeSelection: () => void;
  onRefreshQuote: () => void;
  onCheckStatus: () => void;
};
const planName = { basic: "Basic", pro: "Pro", free: "Free" };
const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
function AmountRow({
  label,
  amount,
  currency,
}: {
  label: string;
  amount: number;
  currency: string;
}) {
  return (
    <Group justify="space-between" wrap="nowrap">
      <Text size="sm">{label}</Text>
      <Text size="sm" fw={600}>
        {formatCurrency(amount, currency)}
      </Text>
    </Group>
  );
}
function QuoteAmounts({ quote }: { quote: BillingChangeReviewQuote }) {
  const { currency } = quote;
  if (quote.timing === "renewal")
    return (
      <Text size="sm">
        No charge today. Your current plan stays active until{" "}
        {date(quote.effectiveAt)}.
      </Text>
    );
  return (
    <Stack gap="xs">
      <AmountRow
        label={quote.chargeLabel}
        amount={quote.planCharge}
        currency={currency}
      />
      {quote.chargePeriod && (
        <Text size="xs" c="dimmed">
          {quote.chargePeriod}
        </Text>
      )}
      {quote.offerSavings > 0 && (
        <AmountRow
          label="Introductory discount"
          amount={-quote.offerSavings}
          currency={currency}
        />
      )}
      {quote.unusedCredit > 0 && (
        <AmountRow
          label={quote.creditLabel}
          amount={-quote.unusedCredit}
          currency={currency}
        />
      )}
      <AmountRow
        label={quote.taxTreatment === "included" ? "Tax included" : "Tax added"}
        amount={quote.taxAmount}
        currency={currency}
      />
      {quote.billingBalance !== 0 && (
        <AmountRow
          label={
            quote.billingBalance > 0
              ? "Previous balance"
              : "Billing credit applied"
          }
          amount={quote.billingBalance}
          currency={currency}
        />
      )}
      {quote.billingBalance > 0 && (
        <Text size="xs" c="dimmed">
          This balance is from your billing account, which may include other
          servers.
        </Text>
      )}
      <Divider />
      <Group justify="space-between">
        <Text fw={700}>Due today</Text>
        <Text fw={700} size="lg">
          {formatCurrency(quote.amountDue, currency)}
        </Text>
      </Group>
      {quote.remainingCredit > 0 && (
        <Text size="xs" c="dimmed">
          {formatCurrency(quote.remainingCredit, currency)} remains as billing
          credit. It can pay future invoices for this billing account, including
          your other servers.
        </Text>
      )}
    </Stack>
  );
}
function ReviewActions({
  quote,
  status,
  onConfirm,
  onBack,
  onContinuePayment,
  onChangeSelection,
  onRefreshQuote,
  onCheckStatus,
}: Props & { status: BillingChangeReviewStatus }) {
  if (status === "cancellation_unknown")
    return <Button onClick={onCheckStatus}>Check status</Button>;
  if (status === "quote_changed")
    return (
      <Group justify="flex-end">
        <Button variant="subtle" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onRefreshQuote}>Review updated total</Button>
      </Group>
    );
  if (status === "payment_required")
    return (
      <Group justify="flex-end" wrap="wrap">
        <Button variant="subtle" onClick={onBack}>
          Cancel change
        </Button>
        <Button variant="light" onClick={onChangeSelection}>
          Change selection
        </Button>
        <Button onClick={onContinuePayment}>Continue payment</Button>
      </Group>
    );
  const label =
    quote.timing === "renewal"
      ? "Schedule change"
      : quote.amountDue > 0
        ? "Confirm and pay " + formatCurrency(quote.amountDue, quote.currency)
        : "Confirm change";
  return (
    <Group justify="flex-end" wrap="wrap">
      <Button
        variant="subtle"
        onClick={onBack}
        disabled={status === "processing"}
      >
        Back
      </Button>
      <Button onClick={onConfirm} loading={status === "processing"}>
        {label}
      </Button>
    </Group>
  );
}
export default function BillingChangeReview(props: Props) {
  const { quote, status = "review" } = props;
  const scheduled = quote.timing === "renewal";
  return (
    <Stack gap="lg" data-testid="billing-change-review">
      <Stack gap={4}>
        <Title order={3}>Change to {planName[quote.targetTier]}</Title>
        <Text size="sm" c="dimmed">
          {quote.serverName}
        </Text>
        <Text size="sm">
          {scheduled
            ? "Starts " + date(quote.effectiveAt)
            : quote.amountDue === 0
              ? "Starts after confirmation"
              : "Starts after payment completes"}
          {quote.targetTier !== "free"
            ? " · Billed " +
              (quote.interval === "year" ? "annually" : "monthly")
            : ""}
        </Text>
      </Stack>
      {quote.offerTerms && (
        <Text size="sm" fw={600}>
          {quote.offerTerms}
        </Text>
      )}
      <QuoteAmounts quote={quote} />
      {quote.nextPlanRate !== null && quote.nextAt && (
        <Text size="sm">
          {scheduled ? "Starts at " : "Renews at "}
          {formatCurrency(quote.nextPlanRate, quote.currency)}/
          {quote.interval === "year" ? "year" : "month"} on {date(quote.nextAt)}
          .{" "}
          {quote.taxTreatment === "included"
            ? "Tax included."
            : "Applicable tax is calculated at billing."}
        </Text>
      )}
      {quote.endingOffer && (
        <Text size="xs" c="dimmed">
          Your {quote.endingOffer} introductory offer ends when this change
          takes effect. Switching back will not restart it.
        </Text>
      )}
      {status === "payment_required" && (
        <Alert color="yellow" title="Payment needs attention">
          Your current plan is still active. Complete payment to apply this
          change, or cancel it.
        </Alert>
      )}
      {status === "processing" && (
        <Alert color="brand" title="Applying your change">
          We're checking your payment and plan status. Please wait before trying
          again.
        </Alert>
      )}
      {status === "quote_changed" && (
        <Alert color="yellow" title="Your total needs a fresh review">
          The previous quote has expired or changed. Review the updated total
          before approving payment. You have not been charged.
        </Alert>
      )}
      {status === "cancellation_unknown" && (
        <Alert color="yellow" title="Cancellation not confirmed">
          We couldn't confirm cancellation. Check the change status before
          retrying payment.
        </Alert>
      )}
      <ReviewActions {...props} status={status} />
    </Stack>
  );
}
